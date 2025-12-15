const axios = require('axios');
const gtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { DateTime } = require('luxon');

const API_URL = 'https://api.opentransportdata.swiss/la/gtfs-rt';
const TOKEN = process.env.REALTIME_API_TOKEN;

// Interval minimal 15s (4/min), TTL configurable via REALTIME_CACHE_MS
const MIN_INTERVAL_MS = 15_000;
// Force TTL to 15s unless explicitly overridden to keep cache fresh relative to poller
const RAW_CACHE_DURATION_MS = Number(process.env.REALTIME_CACHE_MS || 15_000);
const EFFECTIVE_CACHE_MS = Math.max(MIN_INTERVAL_MS, RAW_CACHE_DURATION_MS);

// Historique des fetchs (fenêtre glissante 60s)
let fetchTimestamps = [];

// Cache pour le feed brut et états
let cachedEntities = [];
let lastFetchTime = 0;
let lastFetchedAtISO = null;
let pendingPromise = null;
let customFetcher = null; // injectable pour tests

// Cache normalisé + index pour filtrage ultra rapide
let cachedTripUpdatesNormalized = [];
let indexByTripId = new Map();
let indexByOriginalTripId = new Map();

// Poller automatique
let pollerTimer = null;

function isCacheFresh() {
    const now = Date.now();
    return cachedEntities.length > 0 && (now - lastFetchTime) < EFFECTIVE_CACHE_MS;
}

function updateNormalizedCachesFromEntities() {
    // Recalcule le tableau normalisé et les index à partir des entities brutes
    const tripUpdates = parseTripUpdates(cachedEntities).map(normalizeTripUpdate);
    cachedTripUpdatesNormalized = tripUpdates;
    indexByTripId = new Map();
    indexByOriginalTripId = new Map();
    for (const tu of tripUpdates) {
        const tid = tu?.trip?.tripId || null;
        const oid = tu?.trip?.originalTripId || null;
        if (tid) indexByTripId.set(tid, tu);
        if (oid) indexByOriginalTripId.set(oid, tu);
    }
}

async function doFetch() {
    if (customFetcher) {
        const r = await customFetcher();
        if (r && Array.isArray(r.entities)) {
            cachedEntities = r.entities;
            lastFetchTime = Date.now();
            lastFetchedAtISO = r.fetchedAt || new Date(lastFetchTime).toISOString();
            updateNormalizedCachesFromEntities();
        }
        return { entities: cachedEntities, isRealtime: !!r?.isRealtime, fetchedAt: lastFetchedAtISO };
    }
    try {
        const response = await axios.get(API_URL, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'User-Agent': 'RailQuest',
                'Content-Type': 'application/octet-stream'
            },
            responseType: 'arraybuffer',
            validateStatus: null
        });

        if (response.status === 200) {
            const buffer = Buffer.from(response.data);
            const feed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
            cachedEntities = feed.entity || [];
            lastFetchTime = Date.now();
            lastFetchedAtISO = new Date(lastFetchTime).toISOString();
            updateNormalizedCachesFromEntities();
            console.log(`[Realtime] Fetched ${cachedEntities.length} entities at ${lastFetchedAtISO}`);
            return { entities: cachedEntities, isRealtime: true, fetchedAt: lastFetchedAtISO };
        }
        console.warn(`[Realtime] Fetch returned status ${response.status}, using cache (${cachedEntities.length} entities)`);
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO };
    } catch (err) {
        console.error(`[Realtime] Fetch error: ${err?.message || err}. Using cache (${cachedEntities.length} entities)`);
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO };
    }
}

function pruneFetchWindow(now) {
    fetchTimestamps = fetchTimestamps.filter(ts => (now - ts) < 60_000);
}
function canFetch(now) {
    pruneFetchWindow(now);
    return fetchTimestamps.length < 4;
}

async function fetchGTFSFeed() {
    const now = Date.now();

    if (isCacheFresh()) {
        const cacheAgeMs = now - lastFetchTime;
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO, isCached: true, cacheAgeMs, isStale: false };
    }

    if (!canFetch(now)) {
        const cacheAgeMs = now - lastFetchTime;
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO, isCached: true, cacheAgeMs, isStale: true, rateLimited: true };
    }

    if (!pendingPromise) {
        fetchTimestamps.push(now);
        pendingPromise = doFetch()
            .then(r => {
                const nowAfter = Date.now();
                const cacheAgeMs = nowAfter - lastFetchTime;
                return { ...r, isCached: false, cacheAgeMs, isStale: false };
            })
            .catch(err => {
                const nowErr = Date.now();
                const cacheAgeMs = nowErr - lastFetchTime;
                return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO, isCached: true, cacheAgeMs, isStale: (nowErr - lastFetchTime) >= EFFECTIVE_CACHE_MS, error: err?.message || String(err) };
            })
            .finally(() => { pendingPromise = null; });
    }
    return pendingPromise;
}

function parseTripUpdates(entities) {
    return (entities || [])
        .filter(e => e.tripUpdate)
        .map(e => e.tripUpdate)
        .filter(Boolean);
}

function parseVehiclePositions(entities) {
    return (entities || [])
        .filter(e => e.vehicle)
        .map(e => e.vehicle)
        .filter(Boolean);
}

function normalizeTripUpdate(rawTU) {
    const trip = rawTU.trip || {};
    const stuList = rawTU.stopTimeUpdate || [];

    const norm = {
        trip: {
            tripId: trip.tripId || null,
            routeId: trip.routeId || null,
            startTime: trip.startTime || null,
            startDate: trip.startDate || null,
            originalTripId: trip.originalTripId || null
        },
        stopTimeUpdates: stuList.map(stu => ({
            stopId: stu.stopId || null,
            stopSequence: typeof stu.stopSequence === 'number' ? stu.stopSequence : null,
            arrivalTimeSecs: stu.arrival && stu.arrival.time != null ? Number(stu.arrival.time) : null,
            departureTimeSecs: stu.departure && stu.departure.time != null ? Number(stu.departure.time) : null,
            arrivalDelaySecs: stu.arrival && stu.arrival.delay != null ? Number(stu.arrival.delay) : null,
            departureDelaySecs: stu.departure && stu.departure.delay != null ? Number(stu.departure.delay) : null,
        }))
    };
    return norm;
}

async function getParsedTripUpdates() {
    const { entities, isRealtime, fetchedAt, isCached, cacheAgeMs, isStale, rateLimited, error } = await fetchGTFSFeed();
    const tripUpdates = parseTripUpdates(entities).map(normalizeTripUpdate);
    return { isRealtime, fetchedAt, tripUpdates, isCached, cacheAgeMs, isStale, rateLimited: !!rateLimited, error: error || null };
}

function gtfsHhmmssToSeconds(hhmmss) {
    if (!hhmmss) return null;
    const [h, m, s] = String(hhmmss).split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function midnightEpochForDate(dateStr) {
    const date = DateTime.fromFormat(dateStr || DateTime.now().toFormat('yyyyLLdd'), 'yyyyLLdd', { zone: 'Europe/Zurich' });
    return Math.floor(date.startOf('day').toSeconds());
}

function setCustomFetcher(fn) { customFetcher = fn; }
function clearCustomFetcher() { customFetcher = null; }
function getRealtimeCacheStats() {
    pruneFetchWindow(Date.now());
    return {
        lastFetchTime,
        lastFetchedAtISO,
        cacheCount: cachedEntities.length,
        fetchCountLastMinute: fetchTimestamps.length,
        cacheDurationMs: EFFECTIVE_CACHE_MS
    };
}
function resetRealtimeCache() {
    cachedEntities = [];
    lastFetchTime = 0;
    lastFetchedAtISO = null;
    pendingPromise = null;
    fetchTimestamps = [];
    cachedTripUpdatesNormalized = [];
    indexByTripId = new Map();
    indexByOriginalTripId = new Map();
}

function filterTripUpdatesByIds(tripUpdates, ids) {
    if (!Array.isArray(tripUpdates) || !Array.isArray(ids) || ids.length === 0) return [];
    const set = new Set(ids.filter(Boolean));
    return tripUpdates.filter(tu => {
        const tid = tu?.trip?.tripId || null;
        const oid = tu?.trip?.originalTripId || null;
        return (tid && set.has(tid)) || (oid && set.has(oid));
    });
}

// ---- Nouveaux helpers pour le mode auto-refresh et le filtrage rapide ----
function getCachedTripUpdates() {
    const now = Date.now();
    const cacheAgeMs = lastFetchTime ? (now - lastFetchTime) : Infinity;
    return {
        isRealtime: cacheAgeMs < EFFECTIVE_CACHE_MS,
        fetchedAt: lastFetchedAtISO,
        isCached: true,
        cacheAgeMs,
        isStale: cacheAgeMs >= EFFECTIVE_CACHE_MS,
        tripUpdates: cachedTripUpdatesNormalized,
        warm: cachedTripUpdatesNormalized.length > 0
    };
}

function filterTripUpdatesByIdsCached(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const out = [];
    const seen = new Set();
    for (const id of ids) {
        if (!id) continue;
        const a = indexByTripId.get(id) || null;
        const b = indexByOriginalTripId.get(id) || null;
        if (a && !seen.has(a)) { out.push(a); seen.add(a); }
        if (b && !seen.has(b)) { out.push(b); seen.add(b); }
    }
    return out;
}

async function refreshRealtimeNow() {
    // Force un fetch immédiat (respecte encore les limites via fetchGTFSFeed)
    return await fetchGTFSFeed();
}

function startRealtimeAutoRefresh(intervalMs) {
    const every = 15_000; // force 15s as requested
    if (pollerTimer) clearInterval(pollerTimer);
    pollerTimer = setInterval(() => {
        fetchGTFSFeed().catch(() => {});
    }, every);
    return every;
}
function stopRealtimeAutoRefresh() {
    if (pollerTimer) clearInterval(pollerTimer);
    pollerTimer = null;
}

module.exports = { fetchGTFSFeed, parseTripUpdates, parseVehiclePositions, getParsedTripUpdates, gtfsHhmmssToSeconds, midnightEpochForDate, normalizeTripUpdate, setCustomFetcher, clearCustomFetcher, getRealtimeCacheStats, resetRealtimeCache, filterTripUpdatesByIds, getCachedTripUpdates, filterTripUpdatesByIdsCached, refreshRealtimeNow, startRealtimeAutoRefresh, stopRealtimeAutoRefresh };
