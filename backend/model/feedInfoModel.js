const mongoose = require("mongoose");

const feedInfoSchema = new mongoose.Schema({
    feed_publisher_name: String,
    feed_publisher_url: String,
    feed_lang: String,
    feed_start_date: String,
    feed_end_date: String,
    feed_version: String,
});

module.exports = mongoose.model('feedInfo', feedInfoSchema);