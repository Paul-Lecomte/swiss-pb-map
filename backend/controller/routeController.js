const asyncHandler = require('express-async-handler');
const ProcessedRoute = require('../model/processedRoutesModel');

const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox manquant" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    // Find routes whose bounding boxes intersect with the given bbox
    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    }).limit(150);

    res.json({
        type: "FeatureCollection",
        features: routes.map(route => ({
            type: "Feature",
            geometry: route.geometry,
            properties: {
                route_id: route.route_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                route_desc: route.route_desc,
                bounds: route.bounds,
                route_color: route.route_color,
                route_text_color: route.route_text_color,
                stops: route.stops
            }
        }))
    });
});

module.exports = { getRoutesInBbox };