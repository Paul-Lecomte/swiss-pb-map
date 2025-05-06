const mongoose = require("mongoose");

const processedStopsSchema = new mongoose.Schema({
    stop_id: { type: String, required: true, unique: true },
    stop_name: { type: String, required: true },
    stop_lat: { type: Number, required: true },
    stop_lon: { type: Number, required: true },
    location_type: String,
    parent_station: String,

    // Minimal route/trip data for fast frontend use
    routes: [
        {
            route_id: String,
            route_short_name: String,
            route_long_name: String,
            trip_headsign: String
        }
    ]
});

module.exports = mongoose.model("ProcessedStop", processedStopsSchema);