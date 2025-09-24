const asyncHandler = require('express-async-handler');
const Stops = require("../model/stopsModel")

const getAllStops = asyncHandler(async (req, res) => {
    try {
        const stops = await Stops.find({});
        res.status(200).json(stops);
    } catch(error) {
        res.status(500).json({ message: 'Failed to fetch stops', error: error.message });
    }
})

const getStopsInBbox = asyncHandler(async (req, res) => {
    const { bbox, zoom } = req.query; // bbox = "minLng,minLat,maxLng,maxLat"
    if (!bbox) return res.status(400).json({ error: "bbox manquant" });
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    const stops = await Stops.find({
        stop_lon: { $gte: minLng, $lte: maxLng },
        stop_lat: { $gte: minLat, $lte: maxLat }
    }).limit(zoom < 10 ? 100 : 1000);

    res.json({
        type: "FeatureCollection",
        features: stops.map(stop => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [stop.stop_lon, stop.stop_lat] },
            properties: { name: stop.stop_name, routes: stop.routes }
        }))
    });
})

module.exports = {
    getAllStops,
    getStopsInBbox
}