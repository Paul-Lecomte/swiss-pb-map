const axios = require("axios");
require("dotenv").config();
const { buildGeometryFromSwissTNE } = require("./swisstneHelper");

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
 * Fetch full trajectory geometry directly from the geOps Realtime API.
 */
async function fetchTrajectoryGeometry(train_id, gen_level = 0) {
    if (!train_id) return null;

    const GEOPS_AgPI_KEY = process.env.GEOPS_API_KEY;
    if (!GEOPS_API_KEY) {
        console.warn("⚠️ Missing GEOPS_API_KEY in environment. Skipping geOps trajectory request.");
        return null;
    }

    const baseUrl = "https://api.geops.io/realtime";
    const url = `${baseUrl}/full_trajectory_${train_id}${gen_level ? `?gen_level=${gen_level}` : ""}`;

    try {
        const resp = await axios.get(url, {
            timeout: 10000,
            headers: { Authorization: `Bearer ${GEOPS_API_KEY}` },
        });

        if (resp.status >= 400) {
            // Explicitly handle forbidden / unauthorized / not found
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
            console.warn(`⚠️ geOps API error ${err.response.status} — using SwissTNE fallback`);
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
async function buildRouteGeometry(orderedStops, routeType = 3, parallelism = 2, train_id = null) {
    if (!orderedStops || orderedStops.length < 2) return [];

    // Try geOps trajectory API first
    if (train_id) {
        const apiCoords = await fetchTrajectoryGeometry(train_id);
        if (apiCoords && apiCoords.length > 1) {
            console.log(`✅ Using geOps trajectory geometry for ${train_id} (${apiCoords.length} pts)`);
            return apiCoords;
        }
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

module.exports = {
    buildRouteGeometry,
    mapRouteTypeToProfile,
    fetchTrajectoryGeometry,
};