const mongoose = require("mongoose");

const calendarSchema = new mongoose.Schema({
    service_id: String,
    monday: Number,
    tuesday: Number,
    wednesday: Number,
    thursday: Number,
    friday: Number,
    saturday: Number,
    sunday: Number,
    start_date: String,
    end_date: String,
});

module.exports = mongoose.model("Calendar", calendarSchema);