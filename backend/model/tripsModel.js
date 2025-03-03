const mongoose = require("mongoose");

const tripsSchema = new mongoose.Schema({
    route_id: String,
    service_id: String,
    trip_id: String,
    trip_headsign: String,
    trip_short_name: String,
    direction_id: Number,
    block_id: String,
    shape_id: String,
});

module.exports = mongoose.model("Trip", tripsSchema);