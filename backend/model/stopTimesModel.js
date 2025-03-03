const mongoose = require("mongoose");

const stopTimesSchema = new mongoose.Schema({
    trip_id: String,
    arrival_time: String,
    departure_time: String,
    stop_id: String,
    stop_sequence: Number,
    pickup_type: Number,
    drop_off_type: Number,
});

module.exports = mongoose.model("StopTime", stopTimesSchema);