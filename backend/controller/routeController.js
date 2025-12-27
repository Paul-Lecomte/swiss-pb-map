const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');
const Trip = require('../model/tripsModel');
const Route = require('../model/routesModel');
const { clipPolylineToBBox } = require('../utils/interpolation');

// ----------------- Helpers -----------------
const getCurrentWeekday = () => {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return weekdays[DateTime.now().setZone('Europe/Zurich').weekday % 7];
};

const gtfsTimeToSeconds = (timeStr) => {
    if (!timeStr) return null;
    // Handle potential overflow for times like '25:00:00' (common in GTFS for next-day service)
    const parts = timeStr.split(':').map(Number);
    let h = parts[0];
    let m = parts[1];
    let s = parts[2];
    return h * 3600 + m * 60 + s;
};

const tripIsActive = (trip, weekday, todayStr, currentSeconds) => {
    let runsToday = trip.calendar && Number(trip.calendar[weekday]) === 1;
    if (trip.calendar_dates && Array.isArray(trip.calendar_dates)) {
        const override = trip.calendar_dates.find(cd => cd.date === todayStr);
        if (override) runsToday = override.exception_type === 1; // 1 = service added, 2 = service removed
    }
    if (!runsToday) return false;

    const startSec = gtfsTimeToSeconds(trip.route_start_time);
    let stopSec = gtfsTimeToSeconds(trip.route_stop_time);

    if (startSec == null || stopSec == null) return false;

    // Adjust stopSec for trips that run past midnight
    if (stopSec < startSec) stopSec += 24 * 3600;

    // Check if current time is within 10 minutes (600 seconds) of the trip's start/end
    return currentSeconds >= startSec - 600 && currentSeconds <= stopSec + 600;
};

// ----------------- Route -----------------
const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox, stream } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox missing" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    // New optimization parameters
    const includeStaticParam = String(req.query.include_static ?? '1');
    const includeStaticDefault = includeStaticParam === '1' || includeStaticParam === 'true';
    const knownSet = new Set((req.query.known ? String(req.query.known).split(',').filter(Boolean) : []));
    const onlyNew = String(req.query.only_new ?? '0') === '1' || String(req.query.only_new ?? '0') === 'true';
    const maxTrips = Math.max(1, Math.min( Number(req.query.max_trips ?? 20), 200));
    // New: cap how many routes to process from bbox
    const maxRoutes = Math.max(1, Math.min(Number(req.query.max_routes ?? 100), 500));

    // Initial minimal projection for routes within bbox
    const routeProjection = {
        route_id: 1,
        geometry: 1,
        bounds: 1,
        stops: 1,
        trip_headsign: 1,
        route_short_name: 1,
        route_long_name: 1,
        route_type: 1,
        // route_desc: 1, // Removed for potential optimization, add back if needed immediately
        route_color: 1,
        route_text_color: 1
    };

    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
    }, routeProjection).limit(maxRoutes).lean();

    // Filter known routes if onlyNew is requested
    const candidateRoutes = onlyNew ? routes.filter(r => !knownSet.has(r.route_id)) : routes;

    // Prepare timestamp / weekday once for efficiency
    const now = DateTime.now().setZone('Europe/Zurich');
    const todayStr = now.toFormat('yyyyLLdd');
    const weekday = getCurrentWeekday();
    const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;

    // ----------------- Core Logic for processing a single route (refactored for reuse) -----------------
    const processRouteData = async (route) => {
        // Static only if unknown and globally requested
        const includeStaticForThis = includeStaticDefault && !knownSet.has(route.route_id);

        // Fetch stop times for this specific route, with minimal projection
        const tripDocs = await ProcessedStopTimes.find({ route_id: route.route_id }, {
            route_id: 1,
            trip_id: 1,
            direction_id: 1,
            route_start_time: 1,
            route_stop_time: 1,
            calendar: 1,
            calendar_dates: 1,
            stop_times: 1 // We need this to identify active stop_times
        }).lean();

        if (!tripDocs.length) return null; // No trips for this route

        let activeTrips = [];
        for (const trip of tripDocs) {
            if (tripIsActive(trip, weekday, todayStr, currentSeconds)) {
                // Pre-index stop_times by stop_id for quick lookup
                const mapTimes = Object.create(null);
                if (Array.isArray(trip.stop_times)) {
                    for (const st of trip.stop_times) {
                        mapTimes[st.stop_id] = st;
                    }
                }
                trip._timesByStop = mapTimes; // Temporarily attach for processing
                activeTrips.push(trip);
            }
        }

        if (!activeTrips.length) return null; // No active trips for this route

        // Sort by start_time and limit to maxTrips
        activeTrips.sort((a, b) => (gtfsTimeToSeconds(a.route_start_time) || 0) - (gtfsTimeToSeconds(b.route_start_time) || 0));
        if (activeTrips.length > maxTrips) activeTrips = activeTrips.slice(0, maxTrips);

        const stopOrder = route.stops || [];
        const trip_schedules = activeTrips.map(trip => {
            const pairs = buildTimesForStopOrder(stopOrder, trip);
            return { trip_id: trip.trip_id, original_trip_id: trip.original_trip_id, direction_id: trip.direction_id, times: pairs };
        });

        // Clean up temporary property
        activeTrips.forEach(trip => delete trip._timesByStop);

        return {
            type: 'Feature',
            geometry: includeStaticForThis ? {
                type: route.geometry.type,
                coordinates: clipPolylineToBBox(route.geometry.coordinates, [minLng, minLat, maxLng, maxLat], 0.0005)
            } : null,
            properties: {
                route_id: route.route_id,
                static_included: includeStaticForThis,
                trip_headsign: route.trip_headsign,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                // route_desc: route.route_desc, // Removed here too for consistency
                bounds: includeStaticForThis ? route.bounds : undefined,
                route_color: route.route_color,
                route_text_color: route.route_text_color,
                // Always-compact format (seconds pairs)
                trip_schedules,
                active_trip_count: activeTrips.length,
                // Include stops only if static data is included
                stops: includeStaticForThis ? stopOrder.map(s => ({
                    stop_id: s.stop_id,
                    stop_name: s.stop_name,
                    stop_lat: s.stop_lat,
                    stop_lon: s.stop_lon,
                    stop_sequence: s.stop_sequence
                })) : undefined
            }
        };
    };

    // ----------------- STREAMING Logic (already mostly optimized, minor tweaks) -----------------
    if (stream === '1' || stream === 'true') {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Encoding', 'identity'); // Explicitly no HTTP compression for stream
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        const startedAt = Date.now();
        res.write(JSON.stringify({ meta: true, bbox, totalRoutes: routes.length, filteredRoutes: candidateRoutes.length, knownCount: knownSet.size, onlyNew, startedAt, maxTrips, maxRoutes }) + '\n');

        if (!candidateRoutes.length) {
            res.write(JSON.stringify({ end: true, count: 0, elapsedMs: 0 }) + '\n');
            return res.end();
        }

        let written = 0;
        const concurrency = Math.min(Math.max(Number(req.query.concurrency) || 8, 1), 16);
        const executing = new Set();

        for (const route of candidateRoutes) {
            const p = processRouteData(route) // Use the refactored function
                .then(feature => {
                    if (feature) {
                        res.write(JSON.stringify(feature) + '\n');
                        written += 1;
                    }
                })
                .catch(e => {
                    console.error(`Error processing route ${route.route_id}:`, e);
                    res.write(JSON.stringify({ error: true, route_id: route.route_id, message: e.message }) + '\n');
                })
                .finally(() => { executing.delete(p); });
            executing.add(p);
            if (executing.size >= concurrency) {
                // Wait for one promise to settle before adding more if concurrency limit reached
                await Promise.race(Array.from(executing));
            }
        }
        await Promise.allSettled(Array.from(executing)); // Wait for all remaining tasks

        const elapsed = Date.now() - startedAt;
        res.write(JSON.stringify({ end: true, count: written, elapsedMs: elapsed }) + '\n');
        return res.end();
    }

    // ----------------- NON-STREAMING Fallback (SIGNIFICANTLY OPTIMIZED) -----------------
    // This now mirrors the efficiency of the streaming path by processing routes individually
    // and applying all the data reduction parameters (maxTrips, includeStatic).

    if (!candidateRoutes.length) return res.json({ type: "FeatureCollection", features: [] });

    console.log(`[DEBUG] Starting non-stream processing for ${candidateRoutes.length} candidate routes.`);
    const startedAtNonStream = Date.now();

    const features = [];
    // Process routes one by one, similar to the streaming path's `processOne`
    for (const route of candidateRoutes) {
        const feature = await processRouteData(route); // Use the refactored function
        if (feature) {
            features.push(feature);
        }
    }

    const elapsedNonStream = Date.now() - startedAtNonStream;
    console.log(`[RESULT] ${features.length} active routes returned in non-stream mode. Elapsed: ${elapsedNonStream}ms`);
    res.json({ type: "FeatureCollection", features });
});

// Returns the full geometry of a route + stops + trip_schedules
const getRouteGeometry = asyncHandler(async (req, res) => {
    const routeId = req.params.route_id || req.query.route_id;
    if (!routeId) return res.status(400).json({ error: 'route_id missing' });

    // Safety limit on number of trips
    const maxTrips = Math.max(1, Math.min(Number(req.query.max_trips ?? 500), 5000));

    // Fetch the route
    const route = await ProcessedRoute.findOne({ route_id: routeId }).lean();
    if (!route) return res.status(404).json({ error: 'route not found' });

    // Fetch trips and stop_times associated with the route
    const trips = await ProcessedStopTimes.find({ route_id: routeId }, {
        trip_id: 1,
        original_trip_id: 1,
        direction_id: 1,
        stop_times: 1,
        route_start_time: 1,
        route_stop_time: 1,
        calendar: 1,
        calendar_dates: 1,
    }).lean();

    const stopOrder = route.stops || [];
    const trip_schedules = (trips || []).slice(0, maxTrips).map(trip => {
        const times = buildTimesForStopOrder(stopOrder, trip);
        return {
            trip_id: trip.trip_id,
            original_trip_id: trip.original_trip_id,
            direction_id: trip.direction_id,
            times,
        };
    });

    const feature = {
        type: 'Feature',
        geometry: route.geometry || null,
        properties: {
            route_id: route.route_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_type: route.route_type,
            route_desc: route.route_desc,
            route_color: route.route_color,
            route_text_color: route.route_text_color,
            bounds: route.bounds,
            stops: (route.stops || []).map(s => ({
                stop_id: s.stop_id,
                stop_name: s.stop_name,
                stop_lat: s.stop_lat,
                stop_lon: s.stop_lon,
                stop_sequence: s.stop_sequence,
            })),
            trip_schedules,
            trip_count: trip_schedules.length,
        }
    };

    return res.json(feature);
});

// Resolve full route geometry by trip_id (find route_id then delegate)
async function getRouteGeometryByTrip(req, res) {
    try {
        const { trip_id } = req.params;
        if (!trip_id) return res.status(400).json({ error: 'trip_id required' });
        const trip = await Trip.findOne({ trip_id });
        if (!trip) return res.status(404).json({ error: 'trip not found' });
        req.params.route_id = trip.route_id;
        // Delegate to existing handler
        return getRouteGeometry(req, res);
    } catch (e) {
        console.error('[getRouteGeometryByTrip] failed', e);
        return res.status(500).json({ error: 'server error' });
    }
}

module.exports = {
    getRoutesInBbox,
    getRouteGeometry,
    getRouteGeometryByTrip,
};

function buildTimesForStopOrder(stopOrder, trip) {
    const N = Array.isArray(stopOrder) ? stopOrder.length : 0;
    if (N === 0) return [];

    // Trip stop_times ordered
    const tripStops = Array.isArray(trip.stop_times) ? [...trip.stop_times].sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0)) : [];
    const M = tripStops.length;

    // Fast path: if no stop_times, interpolate from route_start_time to route_stop_time across all stops
    if (M === 0) {
        const startSec = gtfsTimeToSeconds(trip.route_start_time);
        let stopSec = gtfsTimeToSeconds(trip.route_stop_time);
        if (startSec == null || stopSec == null) {
            // return all null if no bounds available
            return Array.from({ length: N }, () => [null, null]);
        }
        if (stopSec < startSec) stopSec += 24 * 3600; // past-midnight handling
        const out = Array.from({ length: N }, (_, i) => {
            const t = N === 1 ? 0 : i / (N - 1);
            const v = Math.round(startSec + (stopSec - startSec) * t);
            return [v, v];
        });
        return out;
    }

    // direction handling: if direction_id === 1, mirror proportional mapping indices
    const reverseDir = Number(trip?.direction_id) === 1;

    // Index by stop_id for direct matches
    const byId = Object.create(null);
    for (const st of tripStops) {
        byId[st.stop_id] = [gtfsTimeToSeconds(st.arrival_time ?? st.departure_time), gtfsTimeToSeconds(st.departure_time ?? st.arrival_time)];
    }

    // Initialize with direct matches
    const result = Array.from({ length: N }, () => [null, null]);
    const filled = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
        const sid = stopOrder[i]?.stop_id;
        if (sid && byId[sid]) {
            result[i] = byId[sid].slice(0);
            filled[i] = true;
        }
    }

    const filledCount = filled.reduce((a, b) => a + (b ? 1 : 0), 0);

    // If no direct matches, map trip indices proportionally to route indices
    if (filledCount === 0) {
        for (let j = 0; j < M; j++) {
            const baseTarget = N === 1 ? 0 : Math.round(j * (N - 1) / (M - 1));
            const target = reverseDir ? (N - 1 - baseTarget) : baseTarget;
            const st = tripStops[j];
            const arr = gtfsTimeToSeconds(st.arrival_time ?? st.departure_time);
            const dep = gtfsTimeToSeconds(st.departure_time ?? st.arrival_time);
            if (!filled[target]) {
                result[target][0] = arr;
                result[target][1] = dep;
                filled[target] = true;
            }
        }
    }

    // Interpolate missing slots between nearest filled neighbors
    let lastIdx = -1;
    for (let i = 0; i < N; i++) {
        if (filled[i]) {
            if (lastIdx >= 0 && i - lastIdx > 1) {
                const left = result[lastIdx];
                const right = result[i];
                const span = i - lastIdx;
                for (let k = 1; k < span; k++) {
                    const t = k / span;
                    for (let c = 0;  c < 2; c++) {
                        const L = left[c];
                        const R = right[c];
                        result[lastIdx + k][c] = (L != null && R != null) ? Math.round(L + (R - L) * t) : (L != null ? L : (R != null ? R : null));
                    }
                    filled[lastIdx + k] = true;
                }
            }
            lastIdx = i;
        }
    }
    // Propagate edges outward
    let firstFilled = filled.indexOf(true);
    if (firstFilled > 0) {
        for (let i = 0; i < firstFilled; i++) {
            result[i][0] = result[firstFilled][0];
            result[i][1] = result[firstFilled][1];
            filled[i] = true;
        }
    }
    let lastFilled = filled.lastIndexOf(true);
    if (lastFilled >= 0 && lastFilled < N - 1) {
        for (let i = lastFilled + 1; i < N; i++) {
            result[i][0] = result[lastFilled][0];
            result[i][1] = result[lastFilled][1];
            filled[i] = true;
        }
    }

    return result;
}
