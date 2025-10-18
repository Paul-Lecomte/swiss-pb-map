const path = require("path");
const fs = require("fs");
const turf = require("@turf/turf");
const GeoJSONRbush = require("geojson-rbush");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");
const { pick } = require("stream-json/filters/Pick");

const BN_EDGE_PATH = path.join(__dirname, "../data/swisstne/bn_edge.json");

// Note: we build a lightweight, per-route spatial index to keep memory low.
// No long-lived global index to avoid multi-GB heap usage.

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

function bboxIntersects(a, b) {
    // a,b: [minX, minY, maxX, maxY]
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

async function buildLocalEdgeIndex(orderedStops, baseType, bufferKm = 2) {
    const routeBBox = computeExpandedBBox(orderedStops, bufferKm);
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

                    // Compute quick bbox of this edge
                    let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
                    const coords = value.geometry && value.geometry.coordinates;
                    if (!coords || coords.length === 0) return;
                    for (const c of coords) {
                        const x = c[0], y = c[1];
                        if (x < eMinX) eMinX = x;
                        if (x > eMaxX) eMaxX = x;
                        if (y < eMinY) eMinY = y;
                        if (y > eMaxY) eMaxY = y;
                    }
                    const edgeBBox = [eMinX, eMinY, eMaxX, eMaxY];
                    if (!bboxIntersects(routeBBox, edgeBBox)) return;

                    // Insert minimal Feature (avoid extra turf allocations)
                    index.insert({ type: "Feature", properties: props, geometry: value.geometry });
                } catch (_) {
                    // ignore malformed features
                }
            })
            .on("end", resolve)
            .on("error", reject);
    });

    return index;
}

/**
 * Find nearest edge using the R-tree index
 */
function findNearestEdge(point, index) {
    // Search within a small bbox first (e.g., 500 m)
    const searchBBox = turf.bbox(turf.buffer(point, 0.5, { units: "kilometers" }));
    const candidates = index.search(turf.bboxPolygon(searchBBox));

    let nearest = null;
    let minDist = Infinity;

    for (const edge of candidates.features || candidates) {
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
async function buildGeometryFromSwissTNE(orderedStops, routeType) {
    if (!orderedStops || orderedStops.length < 2) return [];

    const baseType = getBaseTypeForRoute(routeType);
    // Build a small, per-route index to keep memory usage bounded
    const index = await buildLocalEdgeIndex(orderedStops, baseType, 2);
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