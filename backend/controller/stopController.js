const asyncHandler = require('express-async-handler');
const Stops = require("../model/stopsModel")

const getAllStops = asyncHandler(async (req, res) => {
    try {
        const stops = await Stops.find({});
        res.status(200).json(stops);
    } catch(error) {
        res.status(500).json({ message: 'Failed to fetch stops', error: error.message });
    }
})

module.exports = {
    getAllStops,
}