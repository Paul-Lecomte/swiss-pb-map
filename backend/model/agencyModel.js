const mongoose = require('mongoose')

const agencySchema =new mongoose.schema({
    agency_id: String,
    agency_name: String,
    agency_url: String,
    agency_timezone: String,
    agency_lang: String,
    agency_phone: String,
})

module.exports = mongoose.model("Agency", agencySchema);