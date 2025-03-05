const asyncHandler = require("express-async-handler");
const Stoptime = require("../model/stopTimesModel");
const Trip = require("../model/tripsModel");
const Route = require("../model/routesModel");

const getTrip = asyncHandler(async (req, res) => {
    try {
        const { stop_id } = req.params;

        // Step 1: Find stoptimes for the given stop_id
        const stoptimes = await Stoptime.find({ stop_id });

        if (!stoptimes.length) {
            return res.status(404).json({ message: "No stoptimes found for this stop" });
        }

        // Step 2: Extract trip_ids
        const tripIds = stoptimes.map(st => st.trip_id);

        // Step 3: Find trips matching those trip_ids
        const trips = await Trip.find({ trip_id: { $in: tripIds } });

        if (!trips.length) {
            return res.status(404).json({ message: "No trips found for these stoptimes" });
        }

        // Step 4: Extract route_ids from trips
        const routeIds = trips.map(tr => tr.route_id);

        // Step 5: Find routes matching those route_ids
        const routes = await Route.find({ route_id: { $in: routeIds } });

        if (!routes.length) {
            return res.status(404).json({ message: "No routes found for these trips" });
        }

        // Step 6: Send response
        res.json({ stoptimes, trips, routes });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = {
    getTrip,
}