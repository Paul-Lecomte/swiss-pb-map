const mongoose = require("mongoose");

const transfersSchema = new mongoose.Schema({
    from_stop_id: String,
    to_stop_id: String,
    transfer_type: Number,
    min_transfer_time: Number,
});

module.exports = mongoose.model("Transfer", transfersSchema);