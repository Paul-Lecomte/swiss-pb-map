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
            stop_id: String,
            stop_name: String,
            stop_lat: Number,
            stop_lon: Number,
            stop_sequence: Number,
        }
    ],

    // Precomputed trip data for faster access
    trips: [
        {
            trip_id: String,
            trip_headsign: String,
            trip_short_name: String,
            direction_id: Number,
            service_id: String, // link to calendar (weekday, weekend, etc.)

            // Compressed stop_times for this trip
            stop_times: [
                {
                    stop_id: String,
                    stop_sequence: Number,
                    arrival_time: String,   // HH:MM:SS GTFS format
                    departure_time: String, // HH:MM:SS GTFS format
                }
            ]
        }
    ]
});

module.exports = mongoose.model("ProcessedRoute", processedRouteSchema);