const axios = require("axios");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { buildGeometryFromSwissTNE } = require("./swisstneHelper");

// Simple throttle to ensure we do at most 1 request/sec to geOps API
let lastRequestTime = 0;
async function throttleRequest() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < 1000) {
        await new Promise(resolve => setTimeout(resolve, 10 - elapsed));
    }
    lastRequestTime = Date.now();
}

/**
 * Map GTFS route_type to OSRM profile
 */
function mapRouteTypeToProfile(routeType) {
    switch (parseInt(routeType, 10)) {
        case 2: return "train";
        case 4: return "ferry";
        case 5:
        case 6:
        case 7:
        case 1400:
            return "cycling";
        default:
            return "driving";
    }
}

/**
 * Split stops into overlapping batches of size n.
 * Overlap ensures consecutive segments connect properly.
 */
function batchStops(orderedStops, batchSize = 60) {
    const batches = [];
    for (let i = 0; i < orderedStops.length; i += batchSize - 1) {
        let batch = orderedStops.slice(i, i + batchSize);
        if (i !== 0) batch = [orderedStops[i - 1], ...batch];
        batches.push(batch);
    }
    return batches;
}

/**
 * Query OSRM for coordinates of a stop batch
 */
async function fetchOSRMGeometry(batch, routeType) {
    if (batch.length < 2) return batch.map(s => [s.stop_lon, s.stop_lat]);

    const profile = mapRouteTypeToProfile(routeType);
    const coordsStr = batch.map(s => `${s.stop_lon},${s.stop_lat}`).join(";");
    const url = `http://router.project-osrm.org/route/v1/${profile}/${coordsStr}?overview=full&geometries=geojson`;

    try {
        const resp = await axios.get(url, { timeout: 10000 });
        if (resp.data?.routes?.[0]?.geometry?.coordinates?.length) {
            return resp.data.routes[0].geometry.coordinates;
        }
    } catch (err) {
        console.warn("OSRM fallback failed:", err.message);
    }

    // Last-resort: straight lines
    return batch.map(s => [s.stop_lon, s.stop_lat]);
}

/**
 * Fetch full trajectory geometry directly from the geOps Realtime API (with rate limit).
 */
async function fetchTrajectoryGeometry(train_id, gen_level = 0) {
    if (!train_id) return null;

    const GEOPS_API_KEY = process.env.GEOPS_API_KEY;
    if (!GEOPS_API_KEY) {
        console.warn("⚠️ Missing GEOPS_API_KEY in environment. Skipping geOps trajectory request.");
        return null;
    }

    const baseUrl = "https://api.geops.io/tracker-http/v1";
    const params = new URLSearchParams({ key: GEOPS_API_KEY });
    if (Number.isFinite(gen_level)) params.set("gen_level", String(gen_level));
    const url = `${baseUrl}/journeys/${encodeURIComponent(train_id)}/?${params.toString()}`;

    await throttleRequest(); // ensures 1 request/sec

    try {
        console.log(`🌐 [geOps] Requesting: ${url}`);
        const resp = await axios.get(url, {
            timeout: 100,
            headers: {
                Accept: "application/json"
            },
        });

        if (resp.status >= 400) {
            console.warn(`⚠️ geOps API returned ${resp.status} — using SwissTNE fallback`);
            return null;
        }

        if (resp.data?.features?.length) {
            const geometries = [];
            for (const feature of resp.data.features) {
                const geomCollection = feature.geometry;
                if (geomCollection?.type === "GeometryCollection" && Array.isArray(geomCollection.geometries)) {
                    for (const geom of geomCollection.geometries) {
                        if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
                            geometries.push(...geom.coordinates);
                        }
                    }
                }
            }
            if (geometries.length > 1) return geometries;
        }

        throw new Error("No valid geometry in geOps response");
    } catch (err) {
        if (err.response && [401, 403, 404].includes(err.response.status)) {
            console.warn(`⚠️ geOps API error ${err.response.status}: ${err.response.statusText} — using SwissTNE fallback`);
        } else {
            console.warn(`⚠️ Trajectory API failed for ${train_id}:`, err.message);
        }
        return null;
    }
}

/**
 * Build route geometry using:
 *  geOps → SwissTNE → OSRM → straight lines
 */
// Cache of train_ids that failed within this process to avoid retrying repeatedly
const geOpsFailureCache = new Set();

async function buildRouteGeometry(orderedStops, routeType = 3, parallelism = 2, trainIdOrList = null) {
    if (!orderedStops || orderedStops.length < 2) return [];

    // Try geOps trajectory API first
    const tryAll = String(process.env.GEOPS_TRY_ALL_CANDIDATES || "true").toLowerCase() !== "false";
    const genLevels = String(process.env.GEOPS_TRY_GEN_LEVELS || "0,1").split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));

    const candidates = Array.isArray(trainIdOrList)
        ? trainIdOrList
        : (trainIdOrList ? [trainIdOrList] : []);

    if (candidates.length) {
        for (const train_id of candidates) {
            if (geOpsFailureCache.has(train_id)) {
                continue;
            }
            for (const gen_level of (genLevels.length ? genLevels : [0])) {
                console.log(`🧭 Trying geOps journey id=${train_id} gen_level=${gen_level}`);
                const apiCoords = await fetchTrajectoryGeometry(train_id, gen_level);
                if (apiCoords && apiCoords.length > 1) {
                    console.log(`✅ Using geOps trajectory geometry for ${train_id} (gen_level=${gen_level}, ${apiCoords.length} pts)`);
                    return apiCoords;
                }
                await throttleRequest(); // small spacing between attempts
            }
            geOpsFailureCache.add(train_id);
            if (!tryAll) break; // stop after first failed candidate if disabled
        }
        console.log("ℹ️ No usable geOps geometry found from candidates; falling back to SwissTNE/OSRM");
    }

    // Allow overriding parallelism via env var
    const envPar = parseInt(process.env.ROUTE_GEOM_PARALLELISM || "", 10);
    if (!parallelism || Number.isNaN(parallelism)) {
        parallelism = Number.isInteger(envPar) && envPar > 0 ? envPar : 4;
    }

    const intRouteType = parseInt(routeType, 10);
    const mergedCoords = [];
    const batches = batchStops(orderedStops, 50);

    // Process batches in parallel chunks
    for (let i = 0; i < batches.length; i += parallelism) {
        const batchSlice = batches.slice(i, i + parallelism);

        const batchResults = await Promise.all(
            batchSlice.map(async (batch) => {
                try {
                    const coords = await buildGeometryFromSwissTNE(batch, intRouteType);
                    if (!coords || coords.length < 2)
                        throw new Error("SwissTNE returned too few coordinates");
                    return coords;
                } catch {
                    return fetchOSRMGeometry(batch, intRouteType);
                }
            })
        );

        // Merge results, skipping duplicates
        for (const coords of batchResults) {
            for (const coord of coords) {
                const last = mergedCoords[mergedCoords.length - 1];
                if (!last || last[0] !== coord[0] || last[1] !== coord[1]) {
                    mergedCoords.push(coord);
                }
            }
        }
    }

    return mergedCoords;
}

// ---- geOps trajectories index (from local JSON snapshots) ----
let trajectoriesIndex = null;
let trajectoriesIndexLoaded = false;

function normalizeLineName(name) {
    if (!name) return "";
    return String(name)
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/[.-]/g, "");
}

function loadTrajectoriesFile(filePath, index) {
    try {
        if (!fs.existsSync(filePath)) return;
        const raw = fs.readFileSync(filePath, "utf8");
        const json = JSON.parse(raw);
        const feats = Array.isArray(json.features) ? json.features : [];
        for (const f of feats) {
            const props = f && f.properties ? f.properties : {};
            const line = props.line || {};
            const name = normalizeLineName(line.name);
            const trainId = props.train_id;
            if (name && trainId) {
                if (!index.has(name)) index.set(name, new Set());
                index.get(name).add(trainId);
            }
        }
    } catch (e) {
        console.warn(`⚠️ Failed to load trajectories from ${filePath}:`, e.message);
    }
}

function ensureTrajectoriesIndex() {
    if (trajectoriesIndexLoaded && trajectoriesIndex) return trajectoriesIndex;
    trajectoriesIndex = new Map(); // Map<string, Set<string>>
    const dataDir = path.join(__dirname, "..", "data");
    // Prefer longer horizon first, then shorter as fallback
    const files = [
        path.join(dataDir, "sbb_trajectories_21h.json"),
        path.join(dataDir, "sbb_trajectories_8h.json"),
    ];
    for (const fp of files) loadTrajectoriesFile(fp, trajectoriesIndex);
    trajectoriesIndexLoaded = true;
    console.log(`ℹ️ Trajectories index loaded with ${trajectoriesIndex.size} keys`);
    return trajectoriesIndex;
}

async function findTrainIdByRouteName(routeShortName, routeLongName) {
    // Backward-compatible single-id resolver: returns the first candidate if available
    const list = await findTrainIdsByRouteName(routeShortName, routeLongName);
    return list && list.length ? list[0] : null;
}

async function findTrainIdsByRouteName(routeShortName, routeLongName) {
    const idx = ensureTrajectoriesIndex();
    const maxCandidates = parseInt(process.env.GEOPS_MAX_CANDIDATES || "5", 10) || 5;

    const keys = [];
    if (routeShortName) keys.push(normalizeLineName(routeShortName));
    if (routeLongName) keys.push(normalizeLineName(routeLongName));

    const addVariant = (key, out) => {
        const m = key.match(/^(\D+)(0*)(\d+)$/);
        if (m) {
            const alt = (m[1] || "") + String(parseInt(m[3], 10));
            out.push(alt);
        }
    };

    // Build ordered search keys: exact short, de-zero short, exact long, de-zero long
    const searchKeys = [];
    if (keys[0]) {
        searchKeys.push(keys[0]);
        addVariant(keys[0], searchKeys);
    }
    if (keys[1]) {
        searchKeys.push(keys[1]);
        addVariant(keys[1], searchKeys);
    }

    // Collect candidates preserving order and uniqueness
    const seen = new Set();
    const out = [];
    for (const k of searchKeys) {
        if (!k) continue;
        if (idx.has(k)) {
            for (const id of idx.get(k)) {
                if (!seen.has(id)) {
                    seen.add(id);
                    out.push(id);
                    if (out.length >= maxCandidates) return out;
                }
            }
        }
    }
    return out;
}

// ---- geOps live trajectories feed helpers ----
let liveFeedDisabled = false;
const liveIndexCache = new Map(); // key -> { expires: number, index: Map<string, Set<string>> }

function round(n, d = 3) { return Math.round(n * Math.pow(10, d)) / Math.pow(10, d); }

function expandBounds(bounds, expandKm = 20) {
    if (!bounds) return null;
    const { min_lat, max_lat, min_lon, max_lon } = bounds;
    const kmPerDegLat = 110.574;
    const latExpand = expandKm / kmPerDegLat;
    const latMid = (min_lat + max_lat) / 2;
    const kmPerDegLon = 111.320 * Math.cos(latMid * Math.PI / 180);
    const lonExpand = expandKm / Math.max(kmPerDegLon, 1e-6);
    return {
        min_lat: min_lat - latExpand,
        max_lat: max_lat + latExpand,
        min_lon: min_lon - lonExpand,
        max_lon: max_lon + lonExpand,
    };
}

function makeBBoxKey(b) {
    if (!b) return "nobbox";
    return [round(b.min_lon, 3), round(b.min_lat, 3), round(b.max_lon, 3), round(b.max_lat, 3)].join(",");
}

async function fetchLiveTrajectoriesIndex() {
    const GEOPS_API_KEY = process.env.GEOPS_API_KEY;
    const FEED_ENABLED = String(process.env.GEOPS_FEED_ENABLED || "true").toLowerCase() !== "false";
    const FEED_TTL_MS = parseInt(process.env.GEOPS_FEED_TTL_MS || "30000", 10);

    if (!FEED_ENABLED || liveFeedDisabled) return null;
    if (!GEOPS_API_KEY) {
        console.warn("⚠️ Missing GEOPS_API_KEY; live feed disabled");
        return null;
    }

    const cacheKey = "global";
    const now = Date.now();
    const cached = liveIndexCache.get(cacheKey);
    if (cached && cached.expires > now) {
        return cached.index;
    }

    const baseUrl = "https://api.geops.io/tracker-http/v1/trajectories/sbb/";
    const params = new URLSearchParams({ key: GEOPS_API_KEY });
    const url = `${baseUrl}?${params.toString()}`;

    await throttleRequest();

    try {
        const resp = await axios.get(url, { timeout: 12000, headers: { Accept: "application/json" } });
        if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
        const feats = Array.isArray(resp.data?.features) ? resp.data.features : [];
        const index = new Map(); // Map<normalizedLineName, Set<train_id>>
        for (const f of feats) {
            const props = f?.properties || {};
            const lineName = normalizeLineName(props?.line?.name);
            const trainId = props?.train_id;
            if (!lineName || !trainId) continue;
            if (!index.has(lineName)) index.set(lineName, new Set());
            index.get(lineName).add(trainId);
        }
        liveIndexCache.set(cacheKey, { expires: now + FEED_TTL_MS, index });
        console.log(`🛰️ Live feed indexed ${index.size} line keys (features=${feats.length}) [global]`);
        return index;
    } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
            console.warn(`⚠️ geOps live feed auth error ${status}. Disabling live feed for this run.`);
            liveFeedDisabled = true;
        } else {
            console.warn(`⚠️ Live feed fetch failed: ${err.message}`);
        }
        return null;
    }
}

async function findTrainIdsByRouteNameLive(routeShortName, routeLongName, opts = {}) {
    const GEOPS_MAX_CANDIDATES = parseInt(process.env.GEOPS_MAX_CANDIDATES || "5", 10) || 5;
    const FEED_MAX_FEATURES = parseInt(process.env.GEOPS_FEED_MAX_FEATURES || "500", 10) || 500;
    const EXPAND_KM = parseFloat(process.env.GEOPS_FEED_BBOX_EXPAND_KM || "20");

    const bounds = opts && opts.bounds ? opts.bounds : null;
    const bbox = bounds ? expandBounds(bounds, Number.isFinite(EXPAND_KM) ? EXPAND_KM : 20) : null;

    const index = await fetchLiveTrajectoriesIndex({ bbox, maxFeatures: FEED_MAX_FEATURES });
    if (!index) return [];

    const keys = [];
    if (routeShortName) keys.push(normalizeLineName(routeShortName));
    if (routeLongName) keys.push(normalizeLineName(routeLongName));

    const addVariant = (key, out) => {
        const m = key.match(/^(\D+)(0*)(\d+)$/);
        if (m) {
            const alt = (m[1] || "") + String(parseInt(m[3], 10));
            out.push(alt);
        }
    };

    const searchKeys = [];
    if (keys[0]) { searchKeys.push(keys[0]); addVariant(keys[0], searchKeys); }
    if (keys[1]) { searchKeys.push(keys[1]); addVariant(keys[1], searchKeys); }

    const seen = new Set();
    const out = [];
    for (const k of searchKeys) {
        if (!k) continue;
        if (index.has(k)) {
            for (const id of index.get(k)) {
                if (!seen.has(id)) {
                    seen.add(id);
                    out.push(id);
                    if (out.length >= GEOPS_MAX_CANDIDATES) return out;
                }
            }
        }
    }
    return out;
}

module.exports = {
    buildRouteGeometry,
    mapRouteTypeToProfile,
    fetchTrajectoryGeometry,
    findTrainIdByRouteName,
    findTrainIdsByRouteName,
    fetchLiveTrajectoriesIndex,
    findTrainIdsByRouteNameLive,
};