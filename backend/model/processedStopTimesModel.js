const mongoose = require('mongoose');

const stopTimeSchema = new mongoose.Schema({
    stop_id: String,
    arrival_time: String,
    departure_time: String,
    stop_sequence: Number
});

const processedStopTimesSchema = new mongoose.Schema({
    trip_id: { type: String, index: true },
    route_id: String,
    stop_times: [stopTimeSchema],
    // route_start_time / route_stop_time store the first/last time for the trip (GTFS HH:MM:SS, may exceed 24:00)
    route_start_time: String,
    route_stop_time: String
});

module.exports = mongoose.model('ProcessedStopTimes', processedStopTimesSchema);
