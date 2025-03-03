const mongoose = require("mongoose");

const calendarDatesSchema = new mongoose.Schema({
    service_id: String,
    date: String,
    exception_type: Number,
});

module.exports = mongoose.model("CalendarDate", calendarDatesSchema);