const asyncHandler = require('express-async-handler');
const ProcessedRoute = require('../model/processedRoutesModel');

const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox manquant" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    // Cherche les routes dont les bounds chevauchent la bbox
    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng }
    }).limit(20);

    res.json({
        type: "FeatureCollection",
        features: routes.map(route => ({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: route.stops.map(stop => [stop.stop_lon, stop.stop_lat])
            },
            properties: {
                route_id: route.route_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                route_desc: route.route_desc,
                bounds: route.bounds
            }
        }))
    });
});

module.exports = { getRoutesInBbox };