const asyncHandler = require('express-async-handler');
const Stops = require("../model/stopsModel")

const getAllStops = asyncHandler(async (req, res) => {
    const stops = [];

})

module.exports = {
    getAllStops,
}