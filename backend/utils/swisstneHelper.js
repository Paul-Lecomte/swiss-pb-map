const path = require("path");
const fs = require("fs");
const turf = require("@turf/turf");
const GeoJSONRbush = require("geojson-rbush");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");
const { pick } = require("stream-json/filters/Pick");
const proj4 = require("proj4");

// EPSG:2056 (CH1903+ / LV95) to WGS84
proj4.defs("EPSG:2056", "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs");
const lv95ToWgs84 = (E, N) => {
    const [lon, lat] = proj4("EPSG:2056", "WGS84", [E, N]);
    return [lon, lat];
};

const BN_EDGE_PATH = path.join(__dirname, "../data/swisstne/bn_edge.json");

// Note: we build lightweight spatial indexes and cache them per coarse bbox+basetype
// to avoid re-scanning bn_edge.json for every single route while keeping memory bounded.
const localIndexCache = new Map(); // key -> GeoJSONRbush
const MAX_CACHE_SIZE = 12; // simple LRU cap to limit memory
const globalIndexByBaseType = new Map(); // optional global index cache

function getBaseTypeForRoute(routeType) {
    const t = parseInt(routeType, 10);
    if ([2, 101, 102, 103, 105, 106, 107, 109, 116, 117].includes(t)) return 2; // Rail
    if ([4].includes(t)) return 4; // Ferry
    if ([5, 6, 7, 1400].includes(t)) return 3; // Cableway / Funicular
    return 1; // Roads, buses, cars, etc.
}

/**
 * Build a per-route local spatial index for a given baseType by streaming bn_edge.json
 * and inserting only features whose bbox intersects the route bbox (expanded by bufferKm).
 */
function computeExpandedBBox(orderedStops, bufferKm = 2) {
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const s of orderedStops) {
        if (s.stop_lat < minLat) minLat = s.stop_lat;
        if (s.stop_lat > maxLat) maxLat = s.stop_lat;
        if (s.stop_lon < minLon) minLon = s.stop_lon;
        if (s.stop_lon > maxLon) maxLon = s.stop_lon;
    }
    const delta = bufferKm / 111; // ~degrees per km
    return [minLon - delta, minLat - delta, maxLon + delta, maxLat + delta];
}

function computeTileBBoxFromStops(orderedStops, cellSizeDeg = 0.25, bufferKm = 2) {
    // compute center
    let sumLat = 0, sumLon = 0;
    for (const s of orderedStops) { sumLat += s.stop_lat; sumLon += s.stop_lon; }
    const cy = sumLat / orderedStops.length;
    const cx = sumLon / orderedStops.length;
    const half = cellSizeDeg / 2;
    const bbox = [cx - half, cy - half, cx + half, cy + half];
    // expand by buffer
    const delta = bufferKm / 111;
    return [bbox[0] - delta, bbox[1] - delta, bbox[2] + delta, bbox[3] + delta];
}

function bboxIntersects(a, b) {
    // a,b: [minX, minY, maxX, maxY]
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

async function buildIndexForBBox(bbox, baseType) {
    const index = GeoJSONRbush();

    await new Promise((resolve, reject) => {
        fs.createReadStream(BN_EDGE_PATH)
            .pipe(parser())
            .pipe(pick({ filter: "features" }))
            .pipe(streamArray())
            .on("data", ({ value }) => {
                try {
                    const props = value.properties || {};
                    const bt = props.basetype || 1;
                    if (bt !== baseType) return;

                    // Transform coordinates from LV95 (EPSG:2056) to WGS84 and compute bbox in WGS84
                    const srcCoords = value.geometry && value.geometry.coordinates;
                    if (!srcCoords || srcCoords.length === 0) return;
                    const llCoords = [];
                    let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
                    for (const c of srcCoords) {
                        const [E, N] = c; // ignore Z
                        const [lon, lat] = lv95ToWgs84(E, N);
                        llCoords.push([lon, lat]);
                        if (lon < eMinX) eMinX = lon;
                        if (lon > eMaxX) eMaxX = lon;
                        if (lat < eMinY) eMinY = lat;
                        if (lat > eMaxY) eMaxY = lat;
                    }
                    const edgeBBox = [eMinX, eMinY, eMaxX, eMaxY];
                    if (!bboxIntersects(bbox, edgeBBox)) return;

                    // Insert minimal Feature (avoid extra turf allocations)
                    index.insert({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: llCoords } });
                } catch (_) {
                    // ignore malformed features
                }
            })
            .on("end", resolve)
            .on("error", reject);
    });

    return index;
}

function roundCoord(val, precision = 1) { // 1 decimal ~ 11km
    const p = Math.pow(10, precision);
    return Math.round(val * p) / p;
}

function makeCacheKey(baseType, orderedStops, bufferKm = 2, cellSizeDeg = 0.25) {
    // key by baseType + snapped tile center indexes
    let sumLat = 0, sumLon = 0;
    for (const s of orderedStops) { sumLat += s.stop_lat; sumLon += s.stop_lon; }
    const cy = sumLat / orderedStops.length;
    const cx = sumLon / orderedStops.length;
    const ix = Math.round(cx / cellSizeDeg);
    const iy = Math.round(cy / cellSizeDeg);
    return [baseType, ix, iy, cellSizeDeg, bufferKm].join(':');
}

async function getCachedLocalIndex(baseType, orderedStops, bufferKm = 2, cellSizeDeg = 0.5) {
    const key = makeCacheKey(baseType, orderedStops, bufferKm, cellSizeDeg);
    if (localIndexCache.has(key)) {
        const entry = localIndexCache.get(key);
        // refresh LRU by reinserting
        localIndexCache.delete(key);
        localIndexCache.set(key, entry);
        return entry.index;
    }

    const tileBBox = computeTileBBoxFromStops(orderedStops, cellSizeDeg, bufferKm);
    const idx = await buildIndexForBBox(tileBBox, baseType);
    localIndexCache.set(key, { index: idx, bbox: tileBBox });
    if (localIndexCache.size > MAX_CACHE_SIZE) {
        // evict oldest
        const firstKey = localIndexCache.keys().next().value;
        localIndexCache.delete(firstKey);
    }
    return idx;
}

/**
 * Find nearest edge using the R-tree index
 */
function findNearestEdge(point, index) {
    // Numeric bbox around point with ~200m radius (fast, avoids turf.buffer/bboxPolygon allocations)
    const [lon, lat] = point.geometry.coordinates;
    const radiusKm = 0.2; // 200 m
    const dLat = radiusKm / 111;
    const dLon = dLat / Math.max(Math.cos(lat * Math.PI / 180), 0.1);
    const searchBBox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];

    const candidates = index.search(searchBBox);

    let nearest = null;
    let minDist = Infinity;

    for (const edge of (candidates.features || candidates)) {
        const dist = turf.pointToLineDistance(point, edge, { units: "meters" });
        if (dist < minDist) {
            minDist = dist;
            nearest = edge;
        }
    }

    return nearest;
}

/**
 * Build geometry by snapping stops to nearest edges (fast via spatial index)
 */
async function loadGlobalBaseTypeIndex(baseType) {
    if (globalIndexByBaseType.has(baseType)) return globalIndexByBaseType.get(baseType);
    const index = GeoJSONRbush();
    await new Promise((resolve, reject) => {
        fs.createReadStream(BN_EDGE_PATH)
            .pipe(parser())
            .pipe(pick({ filter: "features" }))
            .pipe(streamArray())
            .on("data", ({ value }) => {
                try {
                    const props = value.properties || {};
                    const bt = props.basetype || 1;
                    if (bt !== baseType) return;
                    const srcCoords = value.geometry && value.geometry.coordinates;
                    if (!srcCoords || srcCoords.length === 0) return;
                    const llCoords = srcCoords.map(c => {
                        const [E, N] = c;
                        const [lon, lat] = lv95ToWgs84(E, N);
                        return [lon, lat];
                    });
                    index.insert({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: llCoords } });
                } catch (_) {}
            })
            .on("end", resolve)
            .on("error", reject);
    });
    globalIndexByBaseType.set(baseType, index);
    return index;
}

async function buildGeometryFromSwissTNE(orderedStops, routeType) {
    if (!orderedStops || orderedStops.length < 2) return [];

    const baseType = getBaseTypeForRoute(routeType);

    // Default to local per-tile index to avoid OOM. Opt-in to global index with SWISSTNE_GLOBAL_INDEX=1
    const useGlobal = process.env.SWISSTNE_GLOBAL_INDEX === '1';
    const index = useGlobal
        ? await loadGlobalBaseTypeIndex(baseType)
        : await getCachedLocalIndex(baseType, orderedStops, 2);
    if (!index) {
        // fallback: straight line
        return orderedStops.map(s => [s.stop_lon, s.stop_lat]);
    }

    const mergedCoords = [];
    const seenEdges = new Set();

    // Precompute nearest edges for stops
    const nearestEdges = orderedStops.map(s => {
        const point = turf.point([s.stop_lon, s.stop_lat]);
        return findNearestEdge(point, index);
    });

    // Merge coordinates for consecutive stops
    for (let i = 0; i < nearestEdges.length - 1; i++) {
        const edgesToUse = [nearestEdges[i], nearestEdges[i + 1]];
        for (const edge of edgesToUse) {
            if (!edge) continue;
            const edgeId = edge.properties.object_id || `${edge.geometry.coordinates[0]}-${edge.geometry.coordinates.slice(-1)}`;
            if (seenEdges.has(edgeId)) continue;
            seenEdges.add(edgeId);

            for (const coord of edge.geometry.coordinates) {
                const last = mergedCoords[mergedCoords.length - 1];
                if (!last || last[0] !== coord[0] || last[1] !== coord[1]) {
                    mergedCoords.push(coord);
                }
            }
        }

        // Fallback if edges missing
        if (!nearestEdges[i] || !nearestEdges[i + 1]) {
            mergedCoords.push([orderedStops[i].stop_lon, orderedStops[i].stop_lat]);
            mergedCoords.push([orderedStops[i + 1].stop_lon, orderedStops[i + 1].stop_lat]);
        }
    }

    return mergedCoords;
}

module.exports = {
    buildGeometryFromSwissTNE
};