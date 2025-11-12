const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');

// ----------------- Helpers -----------------
const getCurrentWeekday = () => {
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    return weekdays[DateTime.now().setZone('Europe/Zurich').weekday % 7];
};

const gtfsTimeToSeconds = (timeStr) => {
    if (!timeStr) return null;
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};

const tripIsActive = (trip, weekday, todayStr, currentSeconds) => {
    let runsToday = trip.calendar && Number(trip.calendar[weekday]) === 1;
    if (trip.calendar_dates && Array.isArray(trip.calendar_dates)) {
        const override = trip.calendar_dates.find(cd => cd.date === todayStr);
        if (override) runsToday = override.exception_type === 1;
    }
    if (!runsToday) return false;

    const startSec = gtfsTimeToSeconds(trip.route_start_time);
    let stopSec = gtfsTimeToSeconds(trip.route_stop_time);
    if (startSec == null || stopSec == null) return false;
    if (stopSec < startSec) stopSec += 24 * 3600;
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
    // fallback: passthrough
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

    // Projection minimale: on limite les champs pour réduire la taille mémoire
    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
    }, {
        route_id: 1,
        geometry: 1,
        bounds: 1,
        stops: 1,
        trip_headsign: 1,
        route_short_name: 1,
        route_long_name: 1,
        route_type: 1,
        route_desc: 1,
        route_color: 1,
        route_text_color: 1
    }).limit(100).lean();

    // Si only_new est demandé, on enlève immédiatement les routes connues
    const candidateRoutes = onlyNew ? routes.filter(r => !knownSet.has(r.route_id)) : routes;

    if (stream === '1' || stream === 'true') {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Encoding', 'identity');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        const startedAt = Date.now();
        if (!candidateRoutes.length) {
            res.write(JSON.stringify({ meta: true, bbox, totalRoutes: routes.length, filteredRoutes: candidateRoutes.length, knownCount: knownSet.size, onlyNew, startedAt }) + '\n');
            res.write(JSON.stringify({ end: true, count: 0, elapsedMs: 0 }) + '\n');
            return res.end();
        }

        // Prépare timestamp / weekday
        const now = DateTime.now().setZone('Europe/Zurich');
        const todayStr = now.toFormat('yyyyLLdd');
        const weekday = getCurrentWeekday();
        const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;

        res.write(JSON.stringify({ meta: true, bbox, totalRoutes: routes.length, filteredRoutes: candidateRoutes.length, knownCount: knownSet.size, onlyNew, startedAt, compactTimes, decimals, maxTrips }) + '\n');

        let written = 0;
        const concurrency = Math.min(Math.max(Number(req.query.concurrency) || 8, 1), 16);

        const processOne = async (route) => {
            // Projection stop_times minimale
            const tripDocs = await ProcessedStopTimes.find({ route_id: route.route_id }, {
                route_id: 1,
                trip_id: 1,
                route_start_time: 1,
                route_stop_time: 1,
                calendar: 1,
                calendar_dates: 1,
                stop_times: 1
            }).lean();
            if (!tripDocs.length) return;

            // Filtre des trips actifs
            let activeTrips = [];
            for (const trip of tripDocs) {
                if (tripIsActive(trip, weekday, todayStr, currentSeconds)) {
                    // Pré-indexation des stop_times par stop_id
                    const mapTimes = Object.create(null);
                    if (Array.isArray(trip.stop_times)) {
                        for (const st of trip.stop_times) {
                            mapTimes[st.stop_id] = st;
                        }
                    }
                    trip._timesByStop = mapTimes;
                    activeTrips.push(trip);
                }
            }
            if (!activeTrips.length) return;
            // Trie par start_time croissant
            activeTrips.sort((a,b) => (gtfsTimeToSeconds(a.route_start_time)||0) - (gtfsTimeToSeconds(b.route_start_time)||0));
            if (activeTrips.length > maxTrips) activeTrips = activeTrips.slice(0, maxTrips);

            // Matrice des horaires alignée sur l'ordre des stops du route
            const stopOrder = route.stops || [];
            const trip_schedules = activeTrips.map(trip => {
                const times = stopOrder.map(s => {
                    const t = trip._timesByStop[s.stop_id];
                    if (!t) return compactTimes ? [null, null] : { arrival_time: null, departure_time: null };
                    if (compactTimes) {
                        return [gtfsTimeToSeconds(t.arrival_time), gtfsTimeToSeconds(t.departure_time)];
                    }
                    return { arrival_time: t.arrival_time, departure_time: t.departure_time };
                });
                return { trip_id: trip.trip_id, times };
            });

            // Statique seulement si non connu et demandé globalement
            const includeStaticForThis = includeStaticDefault && !knownSet.has(route.route_id);
            const feature = {
                type: 'Feature',
                geometry: includeStaticForThis ? roundGeometry(route.geometry, decimals) : null,
                properties: {
                    route_id: route.route_id,
                    static_included: includeStaticForThis,
                    trip_headsign: route.trip_headsign,
                    route_short_name: route.route_short_name,
                    route_long_name: route.route_long_name,
                    route_type: route.route_type,
                    route_desc: route.route_desc,
                    bounds: includeStaticForThis ? route.bounds : undefined,
                    route_color: route.route_color,
                    route_text_color: route.route_text_color,
                    // Nouveau format compact
                    trip_schedules,
                    compact_times: compactTimes,
                    active_trip_count: activeTrips.length,
                    // Inclut stops seulement si statique inclus
                    stops: includeStaticForThis ? stopOrder.map(s => ({
                        stop_id: s.stop_id,
                        stop_name: s.stop_name,
                        stop_lat: s.stop_lat,
                        stop_lon: s.stop_lon,
                        stop_sequence: s.stop_sequence
                    })) : undefined
                }
            };
            res.write(JSON.stringify(feature) + '\n');
            written += 1;
        };

        const executing = new Set();
        for (const route of candidateRoutes) {
            const p = processOne(route)
                .catch(e => {
                    res.write(JSON.stringify({ error: true, route_id: route.route_id, message: e.message }) + '\n');
                })
                .finally(() => { executing.delete(p); });
            executing.add(p);
            if (executing.size >= concurrency) await Promise.race(executing);
        }
        await Promise.allSettled(Array.from(executing));

        const elapsed = Date.now() - startedAt;
        res.write(JSON.stringify({ end: true, count: written, elapsedMs: elapsed }) + '\n');
        return res.end();
    }

    // Non stream fallback avec only_new: on filtre avant mapping
    if (!routes.length) return res.json({ type: "FeatureCollection", features: [] });
    const routeIds = candidateRoutes.map(r => r.route_id);
    const allStopTimes = await ProcessedStopTimes.find({ route_id: { $in: routeIds } }).lean();
    console.log(`[DEBUG] Analyzed ${allStopTimes.length} processed stop_times`);
    const routeTripsMap = {};
    allStopTimes.forEach(doc => {
        if (!routeTripsMap[doc.route_id]) routeTripsMap[doc.route_id] = [];
        routeTripsMap[doc.route_id].push(doc);
    });
    const now = DateTime.now().setZone('Europe/Zurich');
    const todayStr = now.toFormat('yyyyLLdd');
    const weekday = getCurrentWeekday();
    const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;
    const features = candidateRoutes.map(route => {
        const trips = routeTripsMap[route.route_id];
        if (!trips || trips.length === 0) return null;
        const activeTrips = trips.filter(trip => tripIsActive(trip, weekday, todayStr, currentSeconds));
        if (!activeTrips.length) return null;
        const stopsWithTimes = route.stops.map(stop => ({
            ...stop,
            stop_times: activeTrips.flatMap(trip => trip.stop_times.filter(st => st.stop_id === stop.stop_id))
        }));

        return {
            type: "Feature",
            geometry: route.geometry,
            properties: {
                route_id: route.route_id,
                trip_ids: activeTrips.map(t => t.trip_id),
                trip_headsign: route.trip_headsign,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                route_desc: route.route_desc,
                bounds: route.bounds,
                route_color: route.route_color,
                route_text_color: route.route_text_color,
                stops: stopsWithTimes
            }
        };
    }).filter(Boolean);

    console.log(`[RESULT] ${features.length} active routes returned`);
    res.json({ type: "FeatureCollection", features });
});

module.exports = { getRoutesInBbox };