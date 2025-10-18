const axios = require("axios");
const { buildGeometryFromSwissTNE } = require("./swisstneHelper");

/**
 * Map GTFS route_type to OSRM profile
 */
function mapRouteTypeToProfile(routeType) {
    switch (parseInt(routeType, 10)) {
        case 2: return "train";
        case 4: return "ferry";
        case 5: case 6: case 7: case 1400: return "cycling";
        default: return "driving";
    }
}

/**
 * Split stops into overlapping batches of size n.
 * Overlap ensures consecutive segments connect properly.
 */
function batchStops(orderedStops, batchSize = 30) {
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
 * Build route geometry using SwissTNE first, then fallback to OSRM/straight lines.
 * Handles long routes by batching stops to avoid huge arrays.
 * Uses spatial index from swisstneHelper for speed/memory.
 */
async function buildRouteGeometry(orderedStops, routeType = 3, parallelism = 2) {
    if (!orderedStops || orderedStops.length < 2) return [];

    const intRouteType = parseInt(routeType, 10);
    const mergedCoords = [];
    const batches = batchStops(orderedStops, 50);

    // Process batches in parallel chunks
    for (let i = 0; i < batches.length; i += parallelism) {
        const batchSlice = batches.slice(i, i + parallelism);

        const batchResults = await Promise.all(
            batchSlice.map(async batch => {
                try {
                    const coords = await buildGeometryFromSwissTNE(batch, intRouteType);
                    if (!coords || coords.length < 2) throw new Error("SwissTNE returned too few coordinates");
                    return coords;
                } catch {
                    // Fallback to OSRM or straight lines
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

module.exports = {
    buildRouteGeometry,
    mapRouteTypeToProfile
};