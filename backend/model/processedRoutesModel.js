const mongoose = require("mongoose");

const processedRouteSchema = new mongoose.Schema({
    route_id: { type: String, required: true, unique: true },
    agency_id: String,
    route_short_name: String,
    route_long_name: String,
    route_type: String,
    route_desc: String,
    route_color: String,
    route_text_color: String,

    // Ordered list of stops for this route
    stops: [
        {
            stop_id: { type: String, required: true },
            stop_name: String,
            stop_lat: Number,
            stop_lon: Number,
            stop_sequence: Number
        }
    ],

    // Bounds of the route (min/max lat/lon) for frontend display
    bounds: {
        min_lat: Number,
        max_lat: Number,
        min_lon: Number,
        max_lon: Number
    }
});

module.exports = mongoose.model("ProcessedRoute", processedRouteSchema);