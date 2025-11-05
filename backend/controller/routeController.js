const asyncHandler = require('express-async-handler');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');

const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox missing" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    //  Fetch matching routes (lean + limit)
    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    })
        .limit(150)
        .lean(); // returns plain JS objects

    if (!routes.length) return res.json({ type: "FeatureCollection", features: [] });

    //  Collect all trip_ids
    const tripIds = routes.map(r => r.trip_id).filter(Boolean);
    if (!tripIds.length) return res.json({ type: "FeatureCollection", features: [] });

    //  Fetch all preprocessed stop_times for these trip_ids
    const allStopTimes = await ProcessedStopTimes.find(
        { trip_id: { $in: tripIds } },
        { trip_id: 1, stop_times: 1 }
    ).lean();

    //  Map stop_times by trip_id for fast access
    const stopTimesMap = {}; // { [trip_id]: [stop_times] }
    allStopTimes.forEach(doc => {
        stopTimesMap[doc.trip_id] = doc.stop_times;
    });

    //  Attach stop_times to stops in each route
    const features = routes.map(route => {
        const tripStopTimes = stopTimesMap[route.trip_id] || [];

        const stopsWithTimes = route.stops.map(stop => {
            // attach stop_times that match this stop_id
            const st = tripStopTimes.filter(st => st.stop_id === stop.stop_id);
            return {
                ...stop,
                stop_times: st
            };
        });

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