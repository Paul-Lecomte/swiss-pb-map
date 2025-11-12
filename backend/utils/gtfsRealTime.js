const axios = require('axios');
const gtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { DateTime } = require('luxon');

const API_URL = 'https://api.opentransportdata.swiss/la/gtfs-rt';
const TOKEN = process.env.REALTIME_API_TOKEN;

// TTL config (Swiss doc ~2 calls/min). Default 30s, override with REALTIME_CACHE_MS
const CACHE_DURATION_MS = Number(process.env.REALTIME_CACHE_MS || 30_000);

// Cache for the feed
let cachedEntities = [];
let lastFetchTime = 0;
let lastFetchedAtISO = null;
let pendingPromise = null;
let customFetcher = null; // injectable pour tests

function isCacheFresh() {
    const now = Date.now();
    return cachedEntities.length > 0 && (now - lastFetchTime) < CACHE_DURATION_MS;
}

async function doFetch() {
    if (customFetcher) {
        return await customFetcher();
    }
    try {
        const response = await axios.get(API_URL, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'User-Agent': 'RailQuest',
                'Content-Type': 'application/octet-stream'
            },
            responseType: 'arraybuffer',
            validateStatus: null // prevent axios from throwing on non-200
        });

        // Basic logging
        console.log(`[GTFS-RT] Response status: ${response.status}`);
        if (response.data) {
            console.log(`[GTFS-RT] Response length: ${response.data.length} bytes`);
        }

        if (response.status === 200) {
            const buffer = Buffer.from(response.data);
            const feed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
            cachedEntities = feed.entity || [];
            lastFetchTime = Date.now();
            lastFetchedAtISO = new Date(lastFetchTime).toISOString();
            console.log(`[GTFS-RT] Successfully decoded feed (${cachedEntities.length} entities)`);
            return { entities: cachedEntities, isRealtime: true, fetchedAt: lastFetchedAtISO };
        }

        // Handle rate limits or server errors by returning cache
        if (response.status === 429) {
            console.warn('[GTFS-RT] Rate limit exceeded (429). Serving cached feed if available.');
        } else {
            console.error(`[GTFS-RT] Non-200 response (${response.status}). Serving cached feed if available.`);
        }
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO };
    } catch (err) {
        console.error('[GTFS-RT] Fetch error:', err?.message || err);
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO };
    }
}

async function fetchGTFSFeed() {
    const now = Date.now();

    if (isCacheFresh()) {
        console.log(`[GTFS-RT] Returning cached feed (${cachedEntities.length} entities)`);
        return { entities: cachedEntities, isRealtime: false, fetchedAt: lastFetchedAtISO };
    }

    // Coalesce concurrent fetches
    if (!pendingPromise) {
        console.log(`[GTFS-RT] Fetching feed from API at ${new Date(now).toISOString()}`);
        pendingPromise = doFetch()
            .finally(() => {
                pendingPromise = null;
            });
    }
    const result = await pendingPromise;
    return result;
}

// Backward-compat helpers (used by existing code)
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

// New normalized parser
function normalizeTripUpdate(rawTU) {
    const trip = rawTU.trip || {};
    const stuList = rawTU.stopTimeUpdate || [];

    const norm = {
        trip: {
            tripId: trip.tripId || null,
            routeId: trip.routeId || null,
            startTime: trip.startTime || null, // HH:MM:SS
            startDate: trip.startDate || null, // YYYYMMDD
            // vendor-specific original id (best-effort)
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
    const { entities, isRealtime, fetchedAt } = await fetchGTFSFeed();
    const tripUpdates = parseTripUpdates(entities).map(normalizeTripUpdate);
    return { isRealtime, fetchedAt, tripUpdates };
}

// Utility: convert HH:MM:SS to seconds since midnight (supports >24h hours)
function gtfsHhmmssToSeconds(hhmmss) {
    if (!hhmmss) return null;
    const [h, m, s] = String(hhmmss).split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

// Utility: for a given date string YYYYMMDD in Europe/Zurich, returns epoch seconds at midnight
function midnightEpochForDate(dateStr) {
    const date = DateTime.fromFormat(dateStr || DateTime.now().toFormat('yyyyLLdd'), 'yyyyLLdd', { zone: 'Europe/Zurich' });
    return Math.floor(date.startOf('day').toSeconds());
}

function setCustomFetcher(fn) { customFetcher = fn; }
function clearCustomFetcher() { customFetcher = null; }

module.exports = { fetchGTFSFeed, parseTripUpdates, parseVehiclePositions, getParsedTripUpdates, gtfsHhmmssToSeconds, midnightEpochForDate, normalizeTripUpdate, setCustomFetcher, clearCustomFetcher };
