// Routes will resolved to straight path outisde of switzerland
const path = require("path");
const fs = require("fs");
const turf = require("@turf/turf");
const GeoJSONRbush = require("geojson-rbush");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");
const { pick } = require("stream-json/filters/Pick");
const proj4 = require("proj4");

// -----------------------------
// Configuration / paths
// -----------------------------
proj4.defs(
    "EPSG:2056",
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
const lv95ToWgs84 = (E, N) => {
    const [lon, lat] = proj4("EPSG:2056", "WGS84", [E, N]);
    return [lon, lat];
};

const BASE_DIR = path.join(__dirname, "../data/swisstne");
const BN_EDGE_PATH = path.join(BASE_DIR, "bn_edge.json");
const BN_NODE_PATH = path.join(BASE_DIR, "bn_node.json");
const BN_AREA_PATH = path.join(BASE_DIR, "bn_area.json");
const LUT_BASETYPE_PATH = path.join(BASE_DIR, "lut_base_type.json");
const LUT_AREATYPE_PATH = path.join(BASE_DIR, "lut_area_type.json");
const LUT_QUALITYSTATUS_PATH = path.join(BASE_DIR, "lut_quality_status.json");

// -----------------------------
// Caches & constants
// -----------------------------
const localIndexCache = new Map(); // key -> { index, bbox, ts }
const MAX_CACHE_SIZE = 24; // LRU cap
const globalIndexByBaseType = new Map(); // optional global index cache
let nodesById = null; // Map<object_id -> { coord: [lon,lat], props }>
let lutBaseType = null;
let lutAreaType = null;
let lutQualityStatus = null;

// -----------------------------
// Utilities
// -----------------------------
function getBaseTypeForRoute(routeType) {
    const t = parseInt(routeType, 10);
    if ([2, 101, 102, 103, 105, 106, 107, 109, 116, 117].includes(t)) return 2; // Rail
    if ([4].includes(t)) return 4; // Ferry
    if ([5, 6, 7, 1400].includes(t)) return 3; // Cableway / Funicular
    return 1; // Roads, buses, cars, etc.
}

// Per-mode defaults for corridor width (km)
function getCorridorKmForRoute(routeType) {
    const t = parseInt(routeType, 10);
    const dRoad = 0.8;
    const dRail = 1.5;
    const dCable = 0.6;
    const dWater = 2.5;

    if ([2, 101, 102, 103, 105, 106, 107, 109, 116, 117].includes(t)) return dRail;
    if (t === 4) return dWater;
    if ([5, 6, 7, 1400].includes(t)) return dCable;
    return dRoad;
}

// Per-mode snapping radius (meters)
function getSnappingRadiusForRoute(routeType) {
    const t = parseInt(routeType, 10);
    if ([2, 101, 102, 103, 105, 106, 107, 109, 116, 117].includes(t)) return 300; // rail
    if (t === 4) return 500; // ferry
    if ([5, 6, 7, 1400].includes(t)) return 600; // cableway (allow larger)
    return 100; // roads / buses
}

// Approx Swiss bounding box (WGS84) — used to avoid internal fallback straight-lines
function isInSwitzerland(lon, lat) {
    // conservative bounding box: [minLon, minLat, maxLon, maxLat]
    return lon >= 5.9 && lon <= 10.6 && lat >= 45.7 && lat <= 47.9;
}

function bboxIntersects(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function makeCacheKey(baseType, orderedStops, bufferKm = 2, cellSizeDeg = 0.5) {
    let sumLat = 0, sumLon = 0;
    for (const s of orderedStops) {
        sumLat += s.stop_lat;
        sumLon += s.stop_lon;
    }
    const cy = sumLat / orderedStops.length;
    const cx = sumLon / orderedStops.length;
    const ix = Math.round(cx / cellSizeDeg);
    const iy = Math.round(cy / cellSizeDeg);
    return [baseType, ix, iy, cellSizeDeg, bufferKm].join(":");
}

function computeTileBBoxFromStops(orderedStops, cellSizeDeg = 0.25, bufferKm = 2) {
    let sumLat = 0, sumLon = 0;
    for (const s of orderedStops) {
        sumLat += s.stop_lat;
        sumLon += s.stop_lon;
    }
    const cy = sumLat / orderedStops.length;
    const cx = sumLon / orderedStops.length;
    const half = cellSizeDeg / 2;
    const bbox = [cx - half, cy - half, cx + half, cy + half];
    const delta = bufferKm / 111;
    return [bbox[0] - delta, bbox[1] - delta, bbox[2] + delta, bbox[3] + delta];
}

function touchCacheEntry(key) {
    const entry = localIndexCache.get(key);
    if (!entry) return;
    localIndexCache.delete(key);
    localIndexCache.set(key, entry);
    entry.ts = Date.now();
}

// -----------------------------
// Small LUT loaders
// -----------------------------
function tryLoadLUT(filePath) {
    try {
        if (!fs.existsSync(filePath)) return {};
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const map = {};
        if (parsed && Array.isArray(parsed.features)) {
            for (const f of parsed.features) {
                const props = f.properties || {};
                const code = props.object_key ?? props.code ?? props.key ?? props.id;
                const val = props.value ?? props.value_short ?? props.name ?? props.label;
                if (code != null) map[code] = val ?? props;
            }
            return map;
        }
        return parsed;
    } catch (err) { return {}; }
}

// -----------------------------
// Nodes loader
// -----------------------------
async function loadNodesIfNeeded() {
    if (nodesById) return nodesById;
    nodesById = new Map();

    if (!fs.existsSync(BN_NODE_PATH)) return nodesById;

    await new Promise((resolve, reject) => {
        fs.createReadStream(BN_NODE_PATH)
            .pipe(parser())
            .pipe(pick({ filter: "features" }))
            .pipe(streamArray())
            .on("data", ({ value }) => {
                try {
                    const props = value.properties || {};
                    const objectId = props.object_id || props.id;
                    if (!objectId) return;
                    const coords = value.geometry && value.geometry.coordinates;
                    if (!coords || coords.length < 2) return;
                    const [E, N] = coords;
                    const [lon, lat] = lv95ToWgs84(E, N);
                    nodesById.set(objectId, { coord: [lon, lat], props });
                } catch {}
            })
            .on("end", resolve)
            .on("error", reject);
    });

    return nodesById;
}

// -----------------------------
// Build local index
// -----------------------------
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
                    const bt = props.basetype ?? props.base_type ?? 1;
                    if (bt !== baseType) return;

                    const srcCoords = value.geometry && value.geometry.coordinates;
                    if (!srcCoords || srcCoords.length === 0) return;

                    const llCoords = [];
                    let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
                    for (const c of srcCoords) {
                        const [E, N] = c;
                        const [lon, lat] = lv95ToWgs84(E, N);
                        llCoords.push([lon, lat]);
                        eMinX = Math.min(eMinX, lon);
                        eMaxX = Math.max(eMaxX, lon);
                        eMinY = Math.min(eMinY, lat);
                        eMaxY = Math.max(eMaxY, lat);
                    }
                    const edgeBBox = [eMinX, eMinY, eMaxX, eMaxY];
                    if (!bboxIntersects(bbox, edgeBBox)) return;

                    index.insert({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: llCoords } });
                } catch {}
            })
            .on("end", resolve)
            .on("error", reject);
    });
    return index;
}

// -----------------------------
// Global index loader
// -----------------------------
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
                    const bt = props.basetype ?? props.base_type ?? 1;
                    if (bt !== baseType) return;

                    const srcCoords = value.geometry && value.geometry.coordinates;
                    if (!srcCoords || srcCoords.length === 0) return;
                    const llCoords = srcCoords.map(c => lv95ToWgs84(c[0], c[1]));
                    index.insert({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: llCoords } });
                } catch {}
            })
            .on("end", resolve)
            .on("error", reject);
    });

    globalIndexByBaseType.set(baseType, index);
    return index;
}

// -----------------------------
// Nearest edge lookup
// -----------------------------
function findNearestEdge(point, index) {
    const [lon, lat] = point.geometry.coordinates;
    const radiusKm = 0.2;
    const dLat = radiusKm / 111;
    const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
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

    if (!nearest) {
        const r2 = 2;
        const dLat2 = r2 / 111;
        const dLon2 = dLat2 / Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
        const searchBBox2 = [lon - dLon2, lat - dLat2, lon + dLon2, lat + dLon2];
        const candidates2 = index.search(searchBBox2);
        for (const edge of (candidates2.features || candidates2)) {
            const dist = turf.pointToLineDistance(point, edge, { units: "meters" });
            if (dist < minDist) {
                minDist = dist;
                nearest = edge;
            }
        }
    }

    return nearest;
}

// -----------------------------
// Main function: buildGeometryFromSwissTNE
// -----------------------------
async function buildGeometryFromSwissTNE(orderedStops, routeType) {
    if (!orderedStops || orderedStops.length < 2) return [];

    if (!lutBaseType) lutBaseType = tryLoadLUT(LUT_BASETYPE_PATH);
    if (!lutAreaType) lutAreaType = tryLoadLUT(LUT_AREATYPE_PATH);
    if (!lutQualityStatus) lutQualityStatus = tryLoadLUT(LUT_QUALITYSTATUS_PATH);
    await loadNodesIfNeeded();

    const baseType = getBaseTypeForRoute(routeType);
    const useGlobal = false; // default: use local cache
    const corridorKm = Math.max(0.3, parseFloat(getCorridorKmForRoute(routeType)));
    const maxNodes = 200000;
    const hardMaxNodes = 1500000;
    const DEBUG = Boolean(process.env.SWISSTNE_DEBUG === "1" || process.env.SWISSTNE_DEBUG === "true");
    const NO_LIMITS = false;
    const maxCandidates = 12000;

    const dynamicScaleOn = false;
    const scaleK = 0.3;
    const widenFactor = 1.0;

    function getMaxCorridorKm(baseType) {
        const envRoad = 2500;
        const envRail = 2500;
        const envCable = 2500;
        const envWater = 2500;
        if (baseType === 2) return envRail;
        if (baseType === 4) return envWater;
        if (baseType === 3) return envCable;
        return envRoad;
    }

    let currentMaxNodes = maxNodes;
    const index = useGlobal ? await loadGlobalBaseTypeIndex(baseType) : await getCachedLocalIndex(baseType, orderedStops, corridorKm);
    if (!index) return orderedStops.map(s => [s.stop_lon, s.stop_lat]);

    const outCoords = [];
    // Helper: compute corridor bbox around two stops in WGS84
    function makeCorridorBBox(a, b, bufKm) {
        const line = turf.lineString([
            [a.stop_lon, a.stop_lat],
            [b.stop_lon, b.stop_lat]
        ]);
        const buffered = turf.buffer(line, bufKm, { units: 'kilometers' });
        return turf.bbox(buffered);
    }

// Fast geodesic helpers (avoid turf.length per-edge overhead)
    function haversineKm(lon1, lat1, lon2, lat2) {
        const R = 6371;
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLon = (lon2 - lon1) * toRad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    function geodesicLengthKm(coords) {
        let sum = 0;
        for (let i = 1; i < coords.length; i++) {
            const [lon1, lat1] = coords[i - 1];
            const [lon2, lat2] = coords[i];
            sum += haversineKm(lon1, lat1, lon2, lat2);
        }
        return sum;
    }

// Limit candidate edges by proximity to an anchor point using feature bboxes
    function limitCandidatesByAnchor(candidates, anchorLonLat, maxCount) {
        const list = (candidates.features || candidates || []);
        if (!maxCount || list.length <= maxCount) return list;
        const [ax, ay] = anchorLonLat;
        // Score by distance from bbox center to anchor
        const scored = list.map(f => {
            const b = f.bbox || turf.bbox(f);
            const cx = (b[0] + b[2]) / 2;
            const cy = (b[1] + b[3]) / 2;
            const dx = ax - cx;
            const dy = ay - cy;
            return { f, d2: dx * dx + dy * dy };
        });
        scored.sort((u, v) => u.d2 - v.d2);
        return scored.slice(0, maxCount).map(x => x.f);
    }

// Helper: build graph from edges returned by rbush search
    function buildGraph(candidates) {
        const graph = new Map(); // nodeId -> Array<{to, edgeId, weight}>
        const edgeById = new Map();
        const degree = new Map(); // nodeId -> degree count
        const modeFactor = 1.0; // future hook: differentiate per basetype if needed
        const connectorPenaltyKm = parseFloat(process.env.SWISSTNE_PENALTY_CONNECTOR_KM || '0.5');
        const qualityPenaltyKm = parseFloat(process.env.SWISSTNE_PENALTY_QLT2_KM || '0.1');

        for (const f of (candidates.features || candidates)) {
            const props = f.properties || {};
            const fromId = props.from_node_object_id || props.from_node || props.from;
            const toId = props.to_node_object_id || props.to_node || props.to;
            if (!fromId || !toId) continue;
            const coords = f.geometry && f.geometry.coordinates;
            if (!coords || coords.length < 2) continue;
            const eid = props.object_id || props.id || `${fromId}->${toId}:${coords[0]}:${coords[coords.length-1]}`;
            edgeById.set(eid, f);

            // base weight = geometric length (fast haversine)
            let w = geodesicLengthKm(coords) * modeFactor;
            // penalties from documentation attributes
            const isConnector = props.connector === true || props.connector === 1 || props.connector === '1';
            if (isConnector && connectorPenaltyKm > 0) w += connectorPenaltyKm;
            const q = props.quality_status ?? props.quality ?? null;
            if (q === 2 || q === '2') w += qualityPenaltyKm;

            if (!graph.has(fromId)) graph.set(fromId, []);
            if (!graph.has(toId)) graph.set(toId, []);
            graph.get(fromId).push({ to: toId, edgeId: eid, weight: w });
            graph.get(toId).push({ to: fromId, edgeId: eid, weight: w }); // assume bidirectional for base network

            degree.set(fromId, (degree.get(fromId) || 0) + 1);
            degree.set(toId, (degree.get(toId) || 0) + 1);
        }
        return { graph, edgeById, degree };
    }

// Helper: snap stop to nearest edge within bbox; return nearest endpoint nodeId
    function snapStopToNode(stop, bbox, degreeMap, preferNodeId = null, graph = null, routeTypeLocal = routeType) {
        const pt = turf.point([stop.stop_lon, stop.stop_lat]);
        // If we have a preferred node (from previous leg) and it's inside bbox and near the stop, honor it
        if (preferNodeId && graph && graph.has(preferNodeId) && nodesById && nodesById.has(preferNodeId)) {
            const node = nodesById.get(preferNodeId);
            const [nx, ny] = node.coord || [];
            if (nx != null && ny != null) {
                const inBBox = nx >= bbox[0] && nx <= bbox[2] && ny >= bbox[1] && ny <= bbox[3];
                const dMeters = turf.distance(pt, turf.point([nx, ny]), { units: 'meters' }) * 1000;
                const snapRadius = getSnappingRadiusForRoute(routeTypeLocal);
                if (inBBox && dMeters <= Math.max(1000, snapRadius * 3)) { // allow broader acceptance for preferred node
                    return { nodeId: preferNodeId, edge: null };
                }
            }
        }

        // search candidates in bbox and slightly larger radius
        let candidates = index.search(bbox);
        // attempt limited candidate set to speed up
        candidates = limitCandidatesByAnchor(candidates, [stop.stop_lon, stop.stop_lat], NO_LIMITS ? null : Math.max(300, Math.floor(maxCandidates / 2)));
        let best = null;
        let minDist = Infinity;
        for (const e of (candidates.features || candidates)) {
            const d = turf.pointToLineDistance(pt, e, { units: 'meters' });
            if (d < minDist) {
                minDist = d;
                best = e;
            }
        }

        // If nearest found within reasonable radius, accept; otherwise expand search radius using the per-mode snapping
        const snappingRadius = getSnappingRadiusForRoute(routeTypeLocal);
        if (!best || minDist > Math.max(2000, snappingRadius * 5)) {
            // broad search using snappingRadius * 2 (in km)
            const radiusKm = Math.max(0.2, snappingRadius / 1000 * 2);
            const buffered = turf.buffer(pt, radiusKm, { units: 'kilometers' });
            const b = turf.bbox(buffered);
            const broader = index.search(b);
            if (broader && (broader.features || broader).length) {
                let localBest = null;
                let localMin = Infinity;
                for (const e of (broader.features || broader)) {
                    const d = turf.pointToLineDistance(pt, e, { units: 'meters' });
                    if (d < localMin) {
                        localMin = d;
                        localBest = e;
                    }
                }
                if (localBest) {
                    best = localBest;
                    minDist = localMin;
                }
            }
        }

        if (!best) return { nodeId: null, edge: null };
        const props = best.properties || {};
        const fromId = props.from_node_object_id || props.from_node || props.from;
        const toId = props.to_node_object_id || props.to_node || props.to;
        if (!fromId || !toId) return { nodeId: null, edge: null };
        // choose closer endpoint, but bias to higher-degree node if distances are very close
        const coords = best.geometry.coordinates;
        const p0 = turf.point(coords[0]);
        const p1 = turf.point(coords[coords.length - 1]);
        const d0 = turf.distance(pt, p0, { units: 'meters' });
        const d1 = turf.distance(pt, p1, { units: 'meters' });
        let nodeId = d0 <= d1 ? fromId : toId;
        const nearEqual = Math.abs(d0 - d1) <= 5; // within 5m
        if (degreeMap && nearEqual) {
            const deg0 = degreeMap.get(fromId) || 0;
            const deg1 = degreeMap.get(toId) || 0;
            if (deg1 > deg0) nodeId = toId;
            else nodeId = fromId;
        }

        // Additional check: if minDist is somewhat bigger than snappingRadius, we may reject node (so we avoid weird long connectors)
        if (minDist > Math.max(2000, getSnappingRadiusForRoute(routeTypeLocal) * 8)) {
            // too far to snap reliably
            return { nodeId: null, edge: null };
        }

        return { nodeId, edge: best };
    }

// Simple binary heap min-priority queue
    class MinHeap {
        constructor() { this.arr = []; }
        push(item) {
            const a = this.arr;
            a.push(item);
            let i = a.length - 1;
            while (i > 0) {
                const p = ((i - 1) >> 1);
                if (a[p].d <= a[i].d) break;
                [a[p], a[i]] = [a[i], a[p]];
                i = p;
            }
        }
        pop() {
            const a = this.arr;
            if (a.length === 0) return null;
            const top = a[0];
            const last = a.pop();
            if (a.length > 0) {
                a[0] = last;
                // down-heap
                let i = 0;
                const n = a.length;
                while (true) {
                    let l = 2 * i + 1;
                    let r = l + 1;
                    let m = i;
                    if (l < n && a[l].d < a[m].d) m = l;
                    if (r < n && a[r].d < a[m].d) m = r;
                    if (m === i) break;
                    [a[i], a[m]] = [a[m], a[i]];
                    i = m;
                }
            }
            return top;
        }
        get length() { return this.arr.length; }
    }

// Dijkstra over node graph (heap-based)
    function dijkstra(graph, start, goal) {
        const dist = new Map();
        const prev = new Map(); // node -> {node, viaEdgeId}
        const visited = new Set();
        const heap = new MinHeap();
        for (const key of graph.keys()) dist.set(key, Infinity);
        dist.set(start, 0);
        heap.push({ node: start, d: 0 });
        let expansions = 0;
        while (heap.length) {
            const top = heap.pop();
            if (!top) break;
            const node = top.node;
            if (visited.has(node)) continue;
            visited.add(node);
            if (node === goal) break;
            const neigh = graph.get(node) || [];
            const base = dist.get(node);
            for (const { to, edgeId, weight } of neigh) {
                const alt = base + weight;
                if (alt < (dist.get(to) ?? Infinity)) {
                    dist.set(to, alt);
                    prev.set(to, { node, viaEdgeId: edgeId });
                    heap.push({ node: to, d: alt });
                }
            }
            expansions++;
            if (typeof currentMaxNodes === 'number' && currentMaxNodes > 0 && expansions > currentMaxNodes) break;
        }
        if (!prev.has(goal)) return null;
        // reconstruct node path as sequence of edgeIds
        const edgeIds = [];
        let cur = goal;
        while (cur !== start) {
            const info = prev.get(cur);
            if (!info) break;
            edgeIds.push(info.viaEdgeId);
            cur = info.node;
        }
        edgeIds.reverse();
        return edgeIds;
    }

// Append coordinates of an edge with direction and deduplicate
    function appendEdgeCoords(edge, fromNodeId, toNodeId, acc) {
        const props = edge.properties || {};
        const edgeFrom = props.from_node_object_id || props.from_node || props.from;
        const edgeTo = props.to_node_object_id || props.to_node || props.to;
        let coords = edge.geometry.coordinates;
        if (edgeFrom && edgeTo && fromNodeId && toNodeId) {
            const forward = edgeFrom === fromNodeId && edgeTo === toNodeId;
            const backward = edgeFrom === toNodeId && edgeTo === fromNodeId;
            if (backward) coords = [...coords].reverse();
        }
        for (const c of coords) {
            const last = acc[acc.length - 1];
            if (!last || last[0] !== c[0] || last[1] !== c[1]) acc.push(c);
        }
    }

    let prevEndNodeId = null;
    for (let i = 0; i < orderedStops.length - 1; i++) {
        const a = orderedStops[i];
        const b = orderedStops[i + 1];
        const legDistKm = haversineKm(a.stop_lon, a.stop_lat, b.stop_lon, b.stop_lat);
        const maxCorridorKm = getMaxCorridorKm(baseType);
        const baseCorridor = corridorKm;
        const usedCorridorKm = dynamicScaleOn ? Math.min(maxCorridorKm, Math.max(baseCorridor, legDistKm * scaleK)) : baseCorridor;
        let bbox = makeCorridorBBox(a, b, usedCorridorKm);

        const maxAttempts = parseInt(process.env.SWISSTNE_MAX_ATTEMPTS || '5', 10);
        let attempt = 0;
        let succeeded = false;
        if (DEBUG) {
            console.log(`[SwissTNE] Leg ${i+1}/${orderedStops.length-1} dist=${legDistKm.toFixed(2)}km corridor=${usedCorridorKm.toFixed(2)}km`);
        }
        while (attempt < maxAttempts && !succeeded) {
            // scale candidates and node cap with distance; on last attempt lift caps
            const scaledCandidateCap = NO_LIMITS ? null : ((attempt === maxAttempts - 1)
                ? null
                : Math.min(5000, Math.floor(maxCandidates + Math.max(0, legDistKm) * 150)));
            currentMaxNodes = NO_LIMITS ? null : ((attempt === maxAttempts - 1)
                ? hardMaxNodes
                : Math.min(hardMaxNodes, Math.floor(maxNodes + Math.max(0, legDistKm) * 5000)));

            const rawCandidates = index.search(bbox);
            const anchor = [ (a.stop_lon + b.stop_lon) / 2, (a.stop_lat + b.stop_lat) / 2 ];
            const candidates = scaledCandidateCap ? limitCandidatesByAnchor(rawCandidates, anchor, scaledCandidateCap) : (rawCandidates.features || rawCandidates);
            if (!candidates || (candidates.features || candidates).length === 0) {
                // widen corridor and retry
                attempt++;
                const widen = usedCorridorKm * Math.pow(1 + Math.max(0.1, widenFactor), attempt);
                bbox = makeCorridorBBox(a, b, Math.min(maxCorridorKm, widen));
                if (DEBUG) console.log(`[SwissTNE]  widen#${attempt} bbox, candidates=0`);
                continue;
            }
            const { graph, edgeById, degree } = buildGraph(candidates);
            const snapA = snapStopToNode(a, bbox, degree, prevEndNodeId, graph, routeType);
            const snapB = snapStopToNode(b, bbox, degree, null, graph, routeType);
            if (!snapA.nodeId || !snapB.nodeId) {
                attempt++;
                const widen = usedCorridorKm * Math.pow(1 + Math.max(0.1, widenFactor), attempt);
                bbox = makeCorridorBBox(a, b, Math.min(maxCorridorKm, widen));
                if (DEBUG) console.log(`[SwissTNE]  widen#${attempt} snap failed (snapA=${!!snapA.nodeId}, snapB=${!!snapB.nodeId})`);
                continue;
            }
            const pathEdgeIds = dijkstra(graph, snapA.nodeId, snapB.nodeId);
            if (pathEdgeIds && pathEdgeIds.length) {
                // concatenate edges in order
                let prevNode = snapA.nodeId;
                for (const eid of pathEdgeIds) {
                    const e = edgeById.get(eid);
                    if (!e) continue;
                    const props = e.properties || {};
                    const ef = props.from_node_object_id || props.from_node || props.from;
                    const et = props.to_node_object_id || props.to_node || props.to;
                    const nextNode = prevNode === ef ? et : ef;
                    appendEdgeCoords(e, prevNode, nextNode, outCoords);
                    prevNode = nextNode;
                }
                prevEndNodeId = snapB.nodeId;
                succeeded = true;
                break;
            } else {
                attempt++;
                const widen = usedCorridorKm * Math.pow(1 + Math.max(0.1, widenFactor), attempt);
                bbox = makeCorridorBBox(a, b, Math.min(maxCorridorKm, widen));
                if (DEBUG) console.log(`[SwissTNE]  widen#${attempt} path not found (expanded=${currentMaxNodes})`);
            }
        }
        if (!succeeded) {
            // fallback: connect by nearest edge geometries around each stop; as last resort straight segment
            const pta = turf.point([a.stop_lon, a.stop_lat]);
            const ptb = turf.point([b.stop_lon, b.stop_lat]);
            const ea = findNearestEdge(pta, index);
            const eb = findNearestEdge(ptb, index);

            const aInCH = isInSwitzerland(a.stop_lon, a.stop_lat);
            const bInCH = isInSwitzerland(b.stop_lon, b.stop_lat);

            // If both stops are inside Switzerland, try a final large expansion before allowing any straight line
            if (aInCH && bInCH) {
                if (DEBUG) console.log(`[SwissTNE] Final large expansion attempt for leg ${i+1}`);
                const hugeCorridorKm = Math.min(getMaxCorridorKm(baseType), Math.max(usedCorridorKm * 8, 15));
                const hugeBBox = makeCorridorBBox(a, b, hugeCorridorKm);
                const hugeCandidates = index.search(hugeBBox);
                if (hugeCandidates && (hugeCandidates.features || hugeCandidates).length > 0) {
                    const { graph: g2, edgeById: eb2, degree: deg2 } = buildGraph(hugeCandidates);
                    const snapA2 = snapStopToNode(a, hugeBBox, deg2, prevEndNodeId, g2, routeType);
                    const snapB2 = snapStopToNode(b, hugeBBox, deg2, null, g2, routeType);
                    if (snapA2.nodeId && snapB2.nodeId) {
                        const pathEdgeIds2 = dijkstra(g2, snapA2.nodeId, snapB2.nodeId);
                        if (pathEdgeIds2 && pathEdgeIds2.length) {
                            let prevNode = snapA2.nodeId;
                            for (const eid of pathEdgeIds2) {
                                const e = eb2.get(eid);
                                if (!e) continue;
                                const props = e.properties || {};
                                const ef = props.from_node_object_id || props.from_node || props.from;
                                const et = props.to_node_object_id || props.to_node || props.to;
                                const nextNode = prevNode === ef ? et : ef;
                                appendEdgeCoords(e, prevNode, nextNode, outCoords);
                                prevNode = nextNode;
                            }
                            prevEndNodeId = snapB2.nodeId;
                            succeeded = true;
                        }
                    }
                }
            }

            if (!succeeded) {
                // ok, still not succeeded after large expansion
                // Append nearest edge geometries where available (these are local edges, not straight-line)
                if (ea) appendEdgeCoords(ea, null, null, outCoords);
                if (eb) appendEdgeCoords(eb, null, null, outCoords);

                // Only allow a straight-line segment if at least one stop is outside Switzerland (network data may not be available)
                if (!ea && !eb && (!aInCH || !bInCH)) {
                    const last = outCoords[outCoords.length - 1];
                    const segStart = [a.stop_lon, a.stop_lat];
                    const segEnd = [b.stop_lon, b.stop_lat];
                    if (!last || last[0] !== segStart[0] || last[1] !== segStart[1]) outCoords.push(segStart);
                    outCoords.push(segEnd);
                    if (DEBUG) console.log(`[SwissTNE] Allowed straight-line fallback for international leg (${aInCH}, ${bInCH})`);
                } else {
                    // If we appended nearest edges but didn't find both, do not add straight line — break continuity and continue
                    prevEndNodeId = null; // reset continuity on fallback
                    if (DEBUG) console.log(`[SwissTNE] FALLBACK used without straight-line (ea=${!!ea}, eb=${!!eb})`);
                }
            }
        }
    }

    if (outCoords.length === 0) return orderedStops.map((s) => [s.stop_lon, s.stop_lat]);
    return outCoords;
}

// -----------------------------
// Cache helper
// -----------------------------
async function getCachedLocalIndex(baseType, orderedStops, bufferKm = 2, cellSizeDeg = 0.5) {
    const key = makeCacheKey(baseType, orderedStops, bufferKm, cellSizeDeg);
    if (localIndexCache.has(key)) {
        touchCacheEntry(key);
        return localIndexCache.get(key).index;
    }

    const tileBBox = computeTileBBoxFromStops(orderedStops, cellSizeDeg, bufferKm);
    const idx = await buildIndexForBBox(tileBBox, baseType);
    localIndexCache.set(key, { index: idx, bbox: tileBBox, ts: Date.now() });

    if (localIndexCache.size > MAX_CACHE_SIZE) {
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [k, v] of localIndexCache.entries()) {
            if (v.ts < oldestTs) {
                oldestTs = v.ts;
                oldestKey = k;
            }
        }
        if (oldestKey) localIndexCache.delete(oldestKey);
    }

    return idx;
}

// -----------------------------
// Exports
// -----------------------------
module.exports = {
    buildGeometryFromSwissTNE,
    _internal: { loadNodesIfNeeded, loadGlobalBaseTypeIndex, getCachedLocalIndex, tryLoadLUT },
};
