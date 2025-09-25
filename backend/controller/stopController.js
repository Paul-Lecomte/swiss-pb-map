const asyncHandler = require('express-async-handler');
const Stops = require("../model/stopsModel");
const ProcessedStop = require("../model/processedStopsModel");

const getAllStops = asyncHandler(async (req, res) => {
    try {
        const stops = await Stops.find({});
        res.status(200).json(stops);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stops', error: error.message });
    }
});

const getStopsInBbox = asyncHandler(async (req, res) => {
    const { bbox, zoom } = req.query; // bbox = "minLng,minLat,maxLng,maxLat"
    if (!bbox) return res.status(400).json({ error: "bbox manquant" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    const stops = await ProcessedStop.find({
        stop_lon: { $gte: minLng, $lte: maxLng },
        stop_lat: { $gte: minLat, $lte: maxLat }
    }).limit(zoom < 10 ? 100 : 1000);

    res.json({
        type: "FeatureCollection",
        features: stops.map(stop => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [stop.stop_lon, stop.stop_lat]
            },
            properties: {
                stop_id: stop.stop_id,
                stop_name: stop.stop_name,
                stop_lat: stop.stop_lat,
                stop_lon: stop.stop_lon,
                location_type: stop.location_type,
                parent_station: stop.parent_station,
                routes: stop.routes || []
            }
        }))
    });
});

module.exports = {
    getAllStops,
    getStopsInBbox
};