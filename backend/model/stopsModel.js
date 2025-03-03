const mongoose = require("mongoose");

const stopsSchema = new mongoose.Schema({
    stop_id: String,
    stop_name: String,
    stop_lat: Number,
    stop_lon: Number,
    location_type: String,
    parent_station: String,
});

module.exports = mongoose.model("Stop", stopsSchema);