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
    service_id: String,
    direction_id: { type: Number, enum: [0, 1], default: 0 },
    stop_times: [stopTimeSchema],
    route_start_time: String,
    route_stop_time: String,
    calendar: {
        monday: Number,
        tuesday: Number,
        wednesday: Number,
        thursday: Number,
        friday: Number,
        saturday: Number,
        sunday: Number,
        start_date: String,
        end_date: String
    }
});

module.exports = mongoose.model('ProcessedStopTimes', processedStopTimesSchema);