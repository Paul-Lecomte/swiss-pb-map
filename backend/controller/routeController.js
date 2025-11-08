const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');

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

    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    }).limit(50).lean();

    if (!routes.length) return res.json({ type: "FeatureCollection", features: [] });

    const routeIds = routes.map(r => r.route_id);

    // Fetch all stop_times for all trips of these routes
    const allStopTimes = await ProcessedStopTimes.find({ route_id: { $in: routeIds } }).lean();

    console.log(`[DEBUG] Analyzed ${allStopTimes.length} processed stop_times`);

    // Group trips by route_id
    const routeTripsMap = {};
    allStopTimes.forEach(doc => {
        if (!routeTripsMap[doc.route_id]) routeTripsMap[doc.route_id] = [];
        routeTripsMap[doc.route_id].push(doc);
    });

    const now = DateTime.now().setZone('Europe/Zurich');
    const todayStr = now.toFormat('yyyyLLdd');
    const weekday = getCurrentWeekday();
    const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;

    const features = routes.map(route => {
        const trips = routeTripsMap[route.route_id];
        if (!trips || trips.length === 0) return null;

        // Filter trips that run today and have active times
        const activeTrips = trips.filter(trip => {
            let runsToday = trip.calendar && Number(trip.calendar[weekday]) === 1;

            if (trip.calendar_dates && Array.isArray(trip.calendar_dates)) {
                const override = trip.calendar_dates.find(cd => cd.date === todayStr);
                if (override) runsToday = override.exception_type === 1;
            }

            if (!runsToday) return false;

            const startSec = gtfsTimeToSeconds(trip.route_start_time);
            let stopSec = gtfsTimeToSeconds(trip.route_stop_time);
            if (stopSec < startSec) stopSec += 24*3600; // handle past midnight

            return currentSeconds >= startSec - 600 && currentSeconds <= stopSec + 600;
        });

        if (!activeTrips.length) {
            console.log(`[SKIP ${route.route_id}] No active trip now`);
            return null;
        }

        // Merge stop_times from all active trips
        const stopsWithTimes = route.stops.map(stop => ({
            ...stop,
            stop_times: activeTrips.flatMap(trip =>
                trip.stop_times.filter(st => st.stop_id === stop.stop_id)
            )
        }));

        console.log(`[OK] ${route.route_id} has ${activeTrips.length} active trip(s)`);

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