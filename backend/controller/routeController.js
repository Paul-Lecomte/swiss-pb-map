const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');
const { fetchGTFSFeed, parseTripUpdates } = require('../utils/gtfsRealTime');

const getCurrentWeekday = () => {
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    return weekdays[DateTime.now().setZone('Europe/Zurich').weekday % 7];
};

const gtfsTimeToSeconds = (timeStr) => {
    if (!timeStr) return null;
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};

const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox missing" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    console.log(`[DEBUG] Searching routes in bbox: ${minLng},${minLat},${maxLng},${maxLat}`);

    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    }).limit(50).lean();

    console.log(`[DEBUG] Found ${routes.length} routes in bbox`);

    if (!routes.length) return res.json({ type: "FeatureCollection", features: [] });

    const routeIds = routes.map(r => r.route_id);

    // Fetch all stop_times for these routes
    const allStopTimes = await ProcessedStopTimes.find({ route_id: { $in: routeIds } }).lean();
    console.log(`[DEBUG] Found ${allStopTimes.length} stop_times for selected routes`);

    const routeTripsMap = {};
    allStopTimes.forEach(doc => {
        if (!routeTripsMap[doc.route_id]) routeTripsMap[doc.route_id] = [];
        routeTripsMap[doc.route_id].push(doc);
    });

    // Fetch GTFS-RT updates
    const entities = await fetchGTFSFeed();
    const tripUpdates = parseTripUpdates(entities);
    console.log(`[DEBUG] GTFS-RT trip updates fetched: ${tripUpdates.length}`);

    const tripUpdateMap = {};
    tripUpdates.forEach(update => {
        if (update.trip?.tripId) tripUpdateMap[update.trip.tripId] = update;
    });

    const now = DateTime.now().setZone('Europe/Zurich');
    const todayStr = now.toFormat('yyyyLLdd');
    const weekday = getCurrentWeekday();
    const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;

    const features = routes.map(route => {
        const trips = routeTripsMap[route.route_id] || [];
        if (!trips.length) {
            console.log(`[DEBUG] No trips found for route ${route.route_id}`);
            return null;
        }

        const activeTrips = trips.filter(trip => {
            let runsToday = trip.calendar && Number(trip.calendar[weekday]) === 1;
            if (trip.calendar_dates?.length) {
                const override = trip.calendar_dates.find(cd => cd.date === todayStr);
                if (override) runsToday = override.exception_type === 1;
            }
            if (!runsToday) return false;

            const startSec = gtfsTimeToSeconds(trip.route_start_time);
            let stopSec = gtfsTimeToSeconds(trip.route_stop_time);
            if (stopSec < startSec) stopSec += 24*3600;

            const active = currentSeconds >= startSec - 600 && currentSeconds <= stopSec + 600;
            //if (!active) console.log(`[DEBUG] Trip ${trip.trip_id} not active now (start: ${startSec}, stop: ${stopSec}, current: ${currentSeconds})`);
            return active;
        });

        if (!activeTrips.length) return null;
        console.log(`[DEBUG] Route ${route.route_id} has ${activeTrips.length} active trip(s)`);

        const stopsWithTimes = route.stops.map(stop => {
            const stopTimes = activeTrips.flatMap(trip => {
                const originalStopTimes = trip.stop_times.filter(st => st.stop_id === stop.stop_id);

                const update = tripUpdateMap[trip.trip_id];
                if (update?.stopTimeUpdate?.length) {
                    update.stopTimeUpdate.forEach(stu => {
                        originalStopTimes.forEach(ost => {
                            if (ost.stop_id === stu.stopId) {
                                if (stu.arrival?.time) ost.arrival_time = Number(stu.arrival.time);
                                if (stu.departure?.time) ost.departure_time = Number(stu.departure.time);
                            }
                        });
                    });
                }

                return originalStopTimes;
            });

            return { ...stop, stop_times: stopTimes };
        });

        return {
            type: "Feature",
            geometry: route.geometry,
            properties: {
                route_id: route.route_id,
                trip_ids: activeTrips.map(t => t.trip_id),
                directions: [...new Set(activeTrips.map(t => t.direction_id))],
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

    console.log(`[DEBUG] Returning ${features.length} active routes as features`);

    res.json({ type: "FeatureCollection", features });
});

module.exports = { getRoutesInBbox };
