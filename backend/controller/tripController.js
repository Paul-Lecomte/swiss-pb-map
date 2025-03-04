const asyncHandler = require('express-async-handler');
const Stoptime = require("../model/stopTimesModel");
const Trip = require("../model/tripsModel");
const {getAllStops} = require("./stopController");

const getTrip = asyncHandler(async (req, res) => {

})

module.exports = {
    getTrip,
}