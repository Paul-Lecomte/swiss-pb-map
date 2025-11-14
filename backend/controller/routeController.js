const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');

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

const roundCoord = (num, decimals = 5) => {
    if (typeof num !== 'number' || !isFinite(num)) return num;
    const f = Math.pow(10, decimals);
    return Math.round(num * f) / f;
};

const roundGeometry = (geometry, decimals = 5) => {
    if (!geometry) return null;
    if (geometry.type === 'LineString') {
        return {
            type: 'LineString',
            coordinates: geometry.coordinates.map(([lng, lat]) => [roundCoord(lng, decimals), roundCoord(lat, decimals)])
        };
    }
    // fallback: passthrough for other geometry types (e.g., Point if ever used)
    return geometry;
};

// ----------------- Route -----------------
const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox, stream } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox missing" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    // Nouveaux paramètres d'optimisation
    const includeStaticParam = String(req.query.include_static ?? '1');
    const includeStaticDefault = includeStaticParam === '1' || includeStaticParam === 'true';
    const knownSet = new Set((req.query.known ? String(req.query.known).split(',').filter(Boolean) : []));
    const onlyNew = String(req.query.only_new ?? '0') === '1' || String(req.query.only_new ?? '0') === 'true';
    const maxTrips = Math.max(1, Math.min( Number(req.query.max_trips ?? 20), 200));
    const compactTimes = (String(req.query.compact_times ?? '1') === '1' || String(req.query.compact_times ?? '1') === 'true');
    const decimals = Math.max(0, Math.min(Number(req.query.decimals ?? 5), 7));

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
    }, routeProjection).limit(100).lean();

    // Filter known routes if onlyNew is requested
    const candidateRoutes = onlyNew ? routes.filter(r => !knownSet.has(r.route_id)) : routes;

    // Prepare timestamp / weekday once for efficiency
    const now = DateTime.now().setZone('Europe/Zurich');
    const todayStr = now.toFormat('yyyyLLdd');
    const weekday = getCurrentWeekday();
    const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;

    // ----------------- Core Logic for processing a single route (refactored for reuse) -----------------
    const processRouteData = async (route) => {
        // Statique seulement si non connu et demandé globalement
        const includeStaticForThis = includeStaticDefault && !knownSet.has(route.route_id);

        // Fetch stop times for this specific route, with minimal projection
        const tripDocs = await ProcessedStopTimes.find({ route_id: route.route_id }, {
            route_id: 1,
            trip_id: 1,
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
            const times = stopOrder.map(s => {
                const t = trip._timesByStop[s.stop_id];
                if (!t) return compactTimes ? [null, null] : { arrival_time: null, departure_time: null };
                if (compactTimes) {
                    return [gtfsTimeToSeconds(t.arrival_time), gtfsTimeToSeconds(t.departure_time)];
                }
                // Only return needed fields if not compacting
                return { arrival_time: t.arrival_time, departure_time: t.departure_time };
            });
            return { trip_id: trip.trip_id, times };
        });

        // Clean up temporary property
        activeTrips.forEach(trip => delete trip._timesByStop);

        return {
            type: 'Feature',
            geometry: includeStaticForThis ? roundGeometry(route.geometry, decimals) : null,
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
                // New compact format
                trip_schedules,
                compact_times: compactTimes,
                active_trip_count: activeTrips.length,
                // Include stops only if static data is included
                stops: includeStaticForThis ? stopOrder.map(s => ({
                    stop_id: s.stop_id,
                    stop_name: s.stop_name,
                    stop_lat: roundCoord(s.stop_lat, decimals), // Round stop coords too
                    stop_lon: roundCoord(s.stop_lon, decimals), // Round stop coords too
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
        res.write(JSON.stringify({ meta: true, bbox, totalRoutes: routes.length, filteredRoutes: candidateRoutes.length, knownCount: knownSet.size, onlyNew, startedAt, compactTimes, decimals, maxTrips }) + '\n');

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
    // and applying all the data reduction parameters (maxTrips, compactTimes, decimals, includeStatic).

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

module.exports = { getRoutesInBbox };