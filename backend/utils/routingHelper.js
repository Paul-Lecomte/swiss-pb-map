const axios = require("axios");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const proj4 = require("proj4");
// Define LV95 (EPSG:2056) to support detection/conversion when needed
proj4.defs(
    "EPSG:2056",
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
const { buildGeometryFromSwissTNE } = require("./swisstneHelper");

// Simple throttle
let lastRequestTime = 0;
async function throttleRequest() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    const waitMs = Math.max(0, 10 - elapsed);
    if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
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
async function fetchTrajectoryGeometry(train_id) {
    if (!train_id) return null;

    const GEOPS_API_KEY = process.env.GEOPS_API_KEY;
    if (!GEOPS_API_KEY) {
        console.warn("⚠️ Missing GEOPS_API_KEY in environment. Skipping geOps trajectory request.");
        return null;
    }

    const baseUrl = "https://api.geops.io/tracker-http/v1";
    const params = new URLSearchParams({ key: GEOPS_API_KEY });
    const url = `${baseUrl}/journeys/${encodeURIComponent(train_id)}/?${params.toString()}`;

    await throttleRequest(); // ensures 1 request/sec

    try {
        console.log(`🌐 [geOps] Requesting: ${url}`);
        const resp = await axios.get(url, {
            timeout: 12000,
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
            if (geometries.length > 1) {
                // Ensure coordinates are WGS84 lon/lat for frontend
                const wgs = toWGS84IfNeeded(geometries);
                return wgs;
            }
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

async function buildRouteGeometry(orderedStops, routeType = 3, parallelism = 2, trainIdOrList = null, opts = {}) {
    if (!orderedStops || orderedStops.length < 2) return [];

    const intRouteType = parseInt(routeType, 10);

    // Option 2 (configurable): Skip geOps for small city bus routes — use SwissTNE/OSRM directly
    const SKIP_SMALL_BUSES = String(process.env.GEOPS_SKIP_SMALL_BUSES || "false").toLowerCase() === "true";
    if (SKIP_SMALL_BUSES && intRouteType === 3 && orderedStops.length < 50) {
        // Allow overriding parallelism via env var
        const envParBus = parseInt(process.env.ROUTE_GEOM_PARALLELISM || "", 10);
        let parBus = (!parallelism || Number.isNaN(parallelism)) ? (Number.isInteger(envParBus) && envParBus > 0 ? envParBus : 4) : parallelism;
        const mergedBus = [];
        const batchesBus = batchStops(orderedStops, 50);
        for (let i = 0; i < batchesBus.length; i += parBus) {
            const slice = batchesBus.slice(i, i + parBus);
            const results = await Promise.all(
                slice.map(async (batch) => {
                    const allOutsideCH = batch.every(s => (s.stop_lon < 5.9 || s.stop_lon > 10.6 || s.stop_lat < 45.7 || s.stop_lat > 47.9));
                    if (allOutsideCH) {
                        return fetchOSRMGeometry(batch, intRouteType);
                    }
                    try {
                        const coords = await buildGeometryFromSwissTNE(batch, intRouteType);
                        if (!coords || coords.length < 2) throw new Error("SwissTNE returned too few coordinates");
                        return coords;
                    } catch {
                        return fetchOSRMGeometry(batch, intRouteType);
                    }
                })
            );
            for (const coords of results) {
                for (const coord of coords) {
                    const last = mergedBus[mergedBus.length - 1];
                    if (!last || last[0] !== coord[0] || last[1] !== coord[1]) {
                        mergedBus.push(coord);
                    }
                }
            }
        }
        return mergedBus;
    }

    // Try geOps trajectory API first
    const tryAll = String(process.env.GEOPS_TRY_ALL_CANDIDATES || "true").toLowerCase() !== "false";
    const genLevels = String(process.env.GEOPS_TRY_GEN_LEVELS || "0,1").split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));

    const candidates = Array.isArray(trainIdOrList)
        ? trainIdOrList
        : (trainIdOrList ? [trainIdOrList] : []);

    // Option 3: geometry consistency check
    const isGeometryConsistentWithStops = (geometry, stops) => {
        if (!geometry || !geometry.length || !stops || !stops.length) return false;
        const stopLats = stops.map(s => s.stop_lat);
        const stopLons = stops.map(s => s.stop_lon);
        const gLats = geometry.map(c => c[1]);
        const gLons = geometry.map(c => c[0]);
        const stopBox = {
            min_lat: Math.min(...stopLats),
            max_lat: Math.max(...stopLats),
            min_lon: Math.min(...stopLons),
            max_lon: Math.max(...stopLons),
        };
        const geomBox = {
            min_lat: Math.min(...gLats),
            max_lat: Math.max(...gLats),
            min_lon: Math.min(...gLons),
            max_lon: Math.max(...gLons),
        };
        const expand = parseFloat(process.env.GEOM_STOP_BOX_TOLERANCE_DEG || "0.2");
        return !(
            geomBox.max_lat < stopBox.min_lat - expand ||
            geomBox.min_lat > stopBox.max_lat + expand ||
            geomBox.max_lon < stopBox.min_lon - expand ||
            geomBox.min_lon > stopBox.max_lon + expand
        );
    };

    if (candidates.length) {
        for (const train_id of candidates) {
            if (geOpsFailureCache.has(train_id)) {
                continue;
            }
            for (const gen_level of (genLevels.length ? genLevels : [0])) {
                console.log(`🧭 Trying geOps journey id=${train_id} gen_level=${gen_level}`);
                const apiCoords = await fetchTrajectoryGeometry(train_id, gen_level);
                if (apiCoords && apiCoords.length > 1) {
                    if (!isGeometryConsistentWithStops(apiCoords, orderedStops)) {
                        console.warn("❌ geOps geometry inconsistent with stop positions — discarding.");
                    } else {
                        console.log(`✅ Using geOps trajectory geometry for ${train_id} (gen_level=${gen_level}, ${apiCoords.length} pts)`);
                        return apiCoords;
                    }
                }
                await throttleRequest(); // small spacing between attempts
            }
            geOpsFailureCache.add(train_id);
            if (!tryAll) break; // stop after first failed candidate if disabled
        }
        console.log("ℹ️ No usable geOps geometry found from candidates");
    }

    // If Phase 1 requires geOps-only, do not run fallbacks here
    if (opts && opts.geOpsOnly) {
        return null;
    }

    // Allow overriding parallelism via env var
    const envPar = parseInt(process.env.ROUTE_GEOM_PARALLELISM || "", 10);
    if (!parallelism || Number.isNaN(parallelism)) {
        parallelism = Number.isInteger(envPar) && envPar > 0 ? envPar : 4;
    }

    const mergedCoords = [];
    const batches = batchStops(orderedStops, 50);

    // Process batches in parallel chunks
    for (let i = 0; i < batches.length; i += parallelism) {
        const batchSlice = batches.slice(i, i + parallelism);

        const batchResults = await Promise.all(
            batchSlice.map(async (batch) => {
                // Fast path: if all stops in the batch are outside Switzerland, skip SwissTNE and use OSRM
                const allOutsideCH = batch.every(s => (s.stop_lon < 5.9 || s.stop_lon > 10.6 || s.stop_lat < 45.7 || s.stop_lat > 47.9));
                if (allOutsideCH) {
                    return fetchOSRMGeometry(batch, intRouteType);
                }
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

// ---- coordinate CRS helpers ----
const WEBM_MAX = 20037508.342789244; // EPSG:3857 bounds in meters
function isLikelyLonLat(pair) {
    if (!pair || pair.length < 2) return false;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90;
}
function isLikelyWebMercator(pair) {
    if (!pair || pair.length < 2) return false;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // inside web mercator global limits and outside lon/lat range
    return Math.abs(x) <= WEBM_MAX && Math.abs(y) <= WEBM_MAX && (Math.abs(x) > 180 || Math.abs(y) > 90);
}
function isLikelyLV95(pair) {
    // EPSG:2056 (LV95) typical ranges in Switzerland: x≈2'400'000..2'800'000, y≈1'050'000..1'350'000
    if (!pair || pair.length < 2) return false;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x > 2000000 && x < 3000000 && y > 1000000 && y < 2000000;
}
function normalizePairToLonLat(pair) {
    if (!pair || pair.length < 2) return null;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (isLikelyLonLat(pair)) return [x, y];
    if (isLikelyLV95(pair)) {
        const res = proj4("EPSG:2056", "WGS84", [x, y]);
        return [res[0], res[1]];
    }
    if (isLikelyWebMercator(pair)) {
        const res = proj4("EPSG:3857", "WGS84", [x, y]);
        return [res[0], res[1]];
    }
    // Unknown CRS; return as-is to avoid false positives
    return [x, y];
}
function toWGS84IfNeeded(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return coords || [];
    // Peek a few samples to decide dominant CRS
    const sample = coords[0];
    const sample2 = coords[Math.floor(coords.length / 2)] || sample;
    const sample3 = coords[coords.length - 1] || sample;
    const samples = [sample, sample2, sample3];
    const lonlatVotes = samples.filter(isLikelyLonLat).length;
    const webmVotes = samples.filter(isLikelyWebMercator).length;
    const lv95Votes = samples.filter(isLikelyLV95).length;

    if (lonlatVotes >= webmVotes && lonlatVotes >= lv95Votes) {
        // Assume already lon/lat
        return coords;
    }

    // Convert any point that looks like WebMercator or LV95; leave others as-is
    let converted = 0;
    const out = coords.map((p) => {
        if (isLikelyWebMercator(p)) {
            const res = proj4("EPSG:3857", "WGS84", [p[0], p[1]]);
            converted++;
            return [res[0], res[1]];
        }
        if (isLikelyLV95(p)) {
            const res = proj4("EPSG:2056", "WGS84", [p[0], p[1]]);
            converted++;
            return [res[0], res[1]];
        }
        return p;
    });

    if (converted > 0) {
        console.log(`🗺️ Converted ${converted}/${coords.length} coordinates to WGS84 (EPSG:3857/LV95 detected)`);
    }
    return out;
}
function normalizeBoundsToLonLat(b) {
    if (!b || !Array.isArray(b) || b.length < 4) return null;
    const minPair = normalizePairToLonLat([Number(b[0]), Number(b[1])]);
    const maxPair = normalizePairToLonLat([Number(b[2]), Number(b[3])]);
    if (!minPair || !maxPair) return null;
    return {
        min_lon: Math.min(minPair[0], maxPair[0]),
        min_lat: Math.min(minPair[1], maxPair[1]),
        max_lon: Math.max(minPair[0], maxPair[0]),
        max_lat: Math.max(minPair[1], maxPair[1]),
    };
}
function bboxIntersects(a, b) {
    if (!a || !b) return false;
    return !(a.min_lon > b.max_lon || a.max_lon < b.min_lon || a.min_lat > b.max_lat || a.max_lat < b.min_lat);
}

// ---- line name normalization (shared) ----
function normalizeLineName(name) {
    if (!name) return "";
    return String(name)
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/[.-]/g, "");
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

async function fetchLiveTrajectoriesIndex(opts = {}) {
    const GEOPS_API_KEY = process.env.GEOPS_API_KEY;
    const FEED_ENABLED = String(process.env.GEOPS_FEED_ENABLED || "true").toLowerCase() !== "false";
    const FEED_TTL_MS = parseInt(process.env.GEOPS_FEED_TTL_MS || "30000", 10);

    if (!FEED_ENABLED || liveFeedDisabled) return null;
    if (!GEOPS_API_KEY) {
        console.warn("⚠️ Missing GEOPS_API_KEY; live feed disabled");
        return null;
    }

    const bbox = opts && opts.bbox ? opts.bbox : null;
    const maxFeatures = opts && Number.isFinite(opts.maxFeatures) ? Math.max(1, opts.maxFeatures) : null;

    const cacheKey = makeBBoxKey(bbox);
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

        // optional bbox filtering
        function firstLonLat(feature) {
            const g = feature?.geometry;
            if (!g) return null;
            try {
                if (g.type === "Point") return g.coordinates;
                if (g.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length) return g.coordinates[0];
                if (g.type === "MultiLineString" && Array.isArray(g.coordinates) && g.coordinates.length && Array.isArray(g.coordinates[0]) && g.coordinates[0].length) return g.coordinates[0][0];
                if (g.type === "GeometryCollection" && Array.isArray(g.geometries) && g.geometries.length) {
                    const gg = g.geometries.find(x => Array.isArray(x.coordinates) && x.coordinates.length);
                    if (gg && gg.type === "LineString") return gg.coordinates[0];
                    if (gg && gg.type === "Point") return gg.coordinates;
                }
            } catch {}
            return null;
        }

        const DEBUG = String(process.env.GEOPS_BBOX_DEBUG || "false").toLowerCase() === "true";
        function featureBoundsLonLat(f) {
            const props = f?.properties || {};
            const pb = props?.bounds;
            if (Array.isArray(pb) && pb.length >= 4) {
                const nb = normalizeBoundsToLonLat(pb);
                if (nb) return nb;
            }
            const p = firstLonLat(f);
            const lonlat = normalizePairToLonLat(p);
            if (!lonlat) return null;
            return { min_lon: lonlat[0], min_lat: lonlat[1], max_lon: lonlat[0], max_lat: lonlat[1] };
        }

        const filteredFeats = bbox
            ? feats.filter((f, idx) => {
                const fb = featureBoundsLonLat(f);
                const keep = fb ? bboxIntersects(fb, bbox) : false;
                if (DEBUG && idx < 5) {
                    console.log(`[bbox] ${keep ? 'KEEP' : 'DROP'} feature train_id=${f?.properties?.train_id} line=${f?.properties?.line?.name} fb=${fb ? `${fb.min_lon.toFixed(5)},${fb.min_lat.toFixed(5)}-${fb.max_lon.toFixed(5)},${fb.max_lat.toFixed(5)}` : 'null'}`);
                }
                return keep;
            })
            : feats;

        const limitedFeats = maxFeatures ? filteredFeats.slice(0, maxFeatures) : filteredFeats;

        const index = new Map(); // Map<normalizedLineName, Set<train_id>>
        for (const f of limitedFeats) {
            const props = f?.properties || {};
            const lineName = normalizeLineName(props?.line?.name);
            const trainId = props?.train_id;
            if (!lineName || !trainId) continue;
            if (!index.has(lineName)) index.set(lineName, new Set());
            index.get(lineName).add(trainId);
        }
        liveIndexCache.set(cacheKey, { expires: now + FEED_TTL_MS, index });
        const total = feats.length;
        const kept = limitedFeats.length;
        console.log(`🛰️ Live feed indexed ${index.size} line keys (features=${kept}/${total}) [bbox=${cacheKey}]`);
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

// ---- Multi-tenant geOps live trajectories feed ----
const tenantIndexCache = new Map(); // tenant -> { expires, index }

async function fetchTenantTrajectoriesIndex(tenant) {
    const GEOPS_API_KEY = process.env.GEOPS_API_KEY;
    const FEED_TTL_MS = parseInt(process.env.GEOPS_MULTI_TENANT_TTL_MS || process.env.GEOPS_FEED_TTL_MS || "60000", 10);
    if (!GEOPS_API_KEY || !tenant) return null;

    const cacheKey = String(tenant).toLowerCase();
    const now = Date.now();
    const cached = tenantIndexCache.get(cacheKey);
    if (cached && cached.expires > now) return cached.index;

    const baseUrl = `https://api.geops.io/tracker-http/v1/trajectories/${encodeURIComponent(cacheKey)}/`;
    const url = `${baseUrl}?${new URLSearchParams({ key: GEOPS_API_KEY }).toString()}`;

    await throttleRequest();
    try {
        const resp = await axios.get(url, { timeout: 15000, headers: { Accept: "application/json" } });
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
        tenantIndexCache.set(cacheKey, { expires: now + FEED_TTL_MS, index });
        console.log(`🛰️ [Live ${cacheKey}] indexed ${index.size} line keys (features=${feats.length})`);
        return index;
    } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
            console.warn(`⚠️ geOps live feed auth error ${status} for tenant ${tenant}. Disabling this tenant for this run.`);
            tenantIndexCache.set(cacheKey, { expires: now + 3600_000, index: new Map() });
        } else {
            console.warn(`⚠️ Live feed fetch failed for tenant ${tenant}: ${err.message}`);
        }
        return null;
    }
}

function loadTenantsFromFeedData() {
    try {
        const file = path.join(__dirname, "..", "data", "feed_data.json");
        if (!fs.existsSync(file)) return [];
        const raw = fs.readFileSync(file, "utf8");
        const json = JSON.parse(raw);
        const feeds = json && json.feeds ? json.feeds : {};
        const out = [];
        for (const [key, v] of Object.entries(feeds)) {
            const short = v && v.short_name ? String(v.short_name).toLowerCase() : key.toLowerCase();
            const tc = v && typeof v.trajectory_count === "number" ? v.trajectory_count : 0;
            if (tc > 0) out.push(short);
        }
        return out;
    } catch (e) {
        console.warn("⚠️ Failed to read feed_data.json tenants:", e.message);
        return [];
    }
}

function pickNeighborTenantsFromFeed(allTenants) {
    // Prefer commonly relevant neighbors for Switzerland
    const preferred = [
        // Germany
        "db",
        "de-gtfs-de",

        // France
        "sncf",
        "sncf-ter",
        "sncf-transilien",
        "france-sncf-ic",
        "france-sncf-voyages",
        "france-fluo-grand-est-68",
        "france-cotentin",
        "france-normandy",
        "france-bordeaux-metropole",
        "various-ile-de-france",
        "various-ctrl",

        // Italy
        "trenitalia",
        "toscana-trenitalia",
        "sardinien-trains",
        "ti",
        "trenord",
        "toscana-arezzo",
        "toscana-pistoia",
        "toscana-tft",
        "toscana-lineeregionali",
        "toscana-gest",
        "toscana-prato",
        "sardinien-arst",
        "sardinien-cagliari",
        "various-mailand",
        "various-bologna",
        "various-venice-ferry",
        "various-rome",
        "various-neapel",
        "various-trento-urbano",

        // Austria
        "oebb",
        "obb",
        // (no explicit Austrian feeds found — possibly covered by de-gtfs-de)

        // Liechtenstein
        // (covered by Swiss GTFS — no explicit feeds found)

        // Switzerland (local / regional)
        "bvb",
        "bls",
        "tpg",
        "zvv",
        "sbb" // added for completeness
    ].map(s => s.toLowerCase());
    const set = new Set((allTenants || []).map(s => s.toLowerCase()));
    return preferred.filter(t => set.has(t));
}

async function fetchMultiTenantTrajectoriesIndex(tenants) {
    const enabled = String(process.env.GEOPS_MULTI_TENANT_ENABLED || "true").toLowerCase() !== "false";
    if (!enabled) return null;

    let list = Array.isArray(tenants) && tenants.length
        ? tenants
        : String(process.env.GEOPS_EXTRA_TENANTS || "auto").split(",").map(s => s.trim()).filter(Boolean);

    if (list.length === 1 && list[0].toLowerCase() === "auto") {
        const all = loadTenantsFromFeedData();
        const picked = pickNeighborTenantsFromFeed(all);
        list = picked.length ? picked : ["db", "sncf", "trenitalia", "oebb"]; // fallback defaults
    }

    const merged = new Map(); // Map<normalizedLineName, Set<train_id>>
    for (const t of list) {
        const idx = await fetchTenantTrajectoriesIndex(t);
        if (!idx || !idx.size) continue;
        for (const [key, set] of idx.entries()) {
            if (!merged.has(key)) merged.set(key, new Set());
            const outSet = merged.get(key);
            for (const id of set) outSet.add(id);
        }
    }
    if (merged.size) {
        console.log(`🛰️ [Live Multi] merged index keys=${merged.size} from tenants=[${list.join(", ")}]`);
    }
    return merged;
}

async function findTrainIdsByRouteNameMultiTenant(routeShortName, routeLongName, opts = {}) {
    const GEOPS_MAX_CANDIDATES = parseInt(process.env.GEOPS_MAX_CANDIDATES || "5", 10) || 5;

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

    // Build/obtain merged index
    const tenantsEnv = String(process.env.GEOPS_EXTRA_TENANTS || "db,sncf,trenitalia,obb").split(",").map(s => s.trim()).filter(Boolean);
    const index = await fetchMultiTenantTrajectoriesIndex(tenantsEnv);
    if (!index || !index.size) return [];

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

// ---- Waves-based candidate discovery ----
async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function findTrainIdsByRouteNameWithWaves(routeShortName, routeLongName, opts = {}) {
    const waves = Math.max(1, parseInt(process.env.PHASE2_GEOPS_RETRY_WAVES || "3", 10));
    const waveIntervalMs = Math.max(0, parseInt(process.env.PHASE2_GEOPS_WAVE_INTERVAL_MS || "15000", 10));
    const sbbOnly = String(process.env.PHASE2_GEOPS_RETRY_SBB_ONLY || "false").toLowerCase() === "true";
    const expandPerWaveKm = parseFloat(process.env.GEOPS_FEED_EXPAND_PER_WAVE_KM || "10");
    const maxCandidates = parseInt(process.env.GEOPS_MAX_CANDIDATES || "5", 10) || 5;

    const baseBounds = opts && opts.bounds ? opts.bounds : null;

    const seen = new Set();
    const out = [];

    for (let w = 1; w <= waves; w++) {
        const expandKm = Number.isFinite(expandPerWaveKm) ? expandPerWaveKm * (w - 1) : 0;
        const b = baseBounds ? expandBounds(baseBounds, expandKm) : null;

        let foundThisWave = 0;

        // SBB first (trajectories/sbb)
        try {
            const sbbIndex = await fetchLiveTrajectoriesIndex({ bbox: b });
            if (sbbIndex && sbbIndex.size) {
                const keys = [];
                if (routeShortName) keys.push(normalizeLineName(routeShortName));
                if (routeLongName) keys.push(normalizeLineName(routeLongName));
                const addVariant = (key, arr) => {
                    const m = key.match(/^(\D+)(0*)(\d+)$/);
                    if (m) arr.push((m[1] || "") + String(parseInt(m[3], 10)));
                };
                const searchKeys = [];
                if (keys[0]) { searchKeys.push(keys[0]); addVariant(keys[0], searchKeys); }
                if (keys[1]) { searchKeys.push(keys[1]); addVariant(keys[1], searchKeys); }
                for (const k of searchKeys) {
                    if (sbbIndex.has(k)) {
                        for (const id of sbbIndex.get(k)) {
                            if (!seen.has(id)) {
                                seen.add(id);
                                out.push(id);
                                foundThisWave++;
                                if (out.length >= maxCandidates) {
                                    console.log(`🔎 [Wave ${w}] SBB candidates hit max (${out.length})`);
                                    return out;
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`⚠️ [Wave ${w}] SBB index fetch failed: ${e.message}`);
        }

        if (!sbbOnly && out.length < maxCandidates) {
            try {
                const merged = await fetchMultiTenantTrajectoriesIndex();
                if (merged && merged.size) {
                    const keys = [];
                    if (routeShortName) keys.push(normalizeLineName(routeShortName));
                    if (routeLongName) keys.push(normalizeLineName(routeLongName));
                    const addVariant = (key, arr) => {
                        const m = key.match(/^(\D+)(0*)(\d+)$/);
                        if (m) arr.push((m[1] || "") + String(parseInt(m[3], 10)));
                    };
                    const searchKeys = [];
                    if (keys[0]) { searchKeys.push(keys[0]); addVariant(keys[0], searchKeys); }
                    if (keys[1]) { searchKeys.push(keys[1]); addVariant(keys[1], searchKeys); }
                    for (const k of searchKeys) {
                        if (merged.has(k)) {
                            for (const id of merged.get(k)) {
                                if (!seen.has(id)) {
                                    seen.add(id);
                                    out.push(id);
                                    foundThisWave++;
                                    if (out.length >= maxCandidates) {
                                        console.log(`🔎 [Wave ${w}] Multi-tenant candidates hit max (${out.length})`);
                                        return out;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn(`⚠️ [Wave ${w}] Multi-tenant index fetch failed: ${e.message}`);
            }
        }

        if (foundThisWave > 0 || out.length > 0) {
            console.log(`🛰️ [Waves] Found ${foundThisWave} new candidates on wave ${w} (total=${out.length})`);
            return out;
        }

        if (w < waves && waveIntervalMs > 0) {
            console.log(`⏳ [Waves] Waiting ${waveIntervalMs}ms before wave ${w + 1}...`);
            await sleep(waveIntervalMs);
        }
    }

    console.log("ℹ️ [Waves] No candidates after all waves");
    return out;
}

module.exports = {
    buildRouteGeometry,
    mapRouteTypeToProfile,
    fetchTrajectoryGeometry,
    fetchLiveTrajectoriesIndex,
    findTrainIdsByRouteNameLive,
    fetchTenantTrajectoriesIndex,
    fetchMultiTenantTrajectoriesIndex,
    findTrainIdsByRouteNameMultiTenant,
    findTrainIdsByRouteNameWithWaves,
    // export CRS helpers for defensive checks at insertion time
    toWGS84IfNeeded,
    isLikelyLonLat,
    isLikelyWebMercator,
};