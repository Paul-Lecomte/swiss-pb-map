const asyncHandler = require('express-async-handler');
const ProcessedRoute = require('../model/processedRoutesModel');
const StopTime = require('../model/stopTimesModel');

const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox missing" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    // 1️⃣ Fetch matching routes
    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    }).limit(150);

    if (!routes.length) return res.json({ type: "FeatureCollection", features: [] });

    // 2️⃣ Collect all trip_ids
    const tripIds = routes.map(r => r.trip_id).filter(Boolean);

    // 3️⃣ Fetch all stop_times for all trip_ids at once
    const allStopTimes = await StopTime.find({ trip_id: { $in: tripIds } }).sort({ stop_sequence: 1 });

    // 4️⃣ Map stop_times by trip_id then stop_id
    const stopTimesMap = new Map(); // trip_id -> Map(stop_id -> stop_time)
    allStopTimes.forEach(st => {
        if (!stopTimesMap.has(st.trip_id)) stopTimesMap.set(st.trip_id, new Map());
        stopTimesMap.get(st.trip_id).set(st.stop_id, {
            arrival_time: st.arrival_time,
            departure_time: st.departure_time,
            stop_sequence: st.stop_sequence
        });
    });

    // 5️⃣ Attach stop_times to stops in routes
    const features = routes.map(route => {
        const tripStopTimes = stopTimesMap.get(route.trip_id) || new Map();

        const stopsWithTimes = route.stops.map(stop => ({
            ...stop.toObject ? stop.toObject() : stop,
            stop_times: tripStopTimes.get(stop.stop_id) ? [tripStopTimes.get(stop.stop_id)] : []
        }));

        return {
            type: "Feature",
            geometry: route.geometry,
            properties: {
                route_id: route.route_id,
                trip_id: route.trip_id,
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
    });

    res.json({ type: "FeatureCollection", features });
});

module.exports = { getRoutesInBbox };