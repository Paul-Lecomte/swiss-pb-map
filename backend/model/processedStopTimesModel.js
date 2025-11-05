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
    stop_times: [stopTimeSchema]
});

module.exports = mongoose.model('ProcessedStopTimes', processedStopTimesSchema);
