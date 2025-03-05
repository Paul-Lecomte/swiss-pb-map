const asyncHandler = require("express-async-handler");
const StopTime = require("../model/stopTimesModel");
const Trip = require("../model/tripsModel");
const Route = require("../model/routesModel");

const getTrip = asyncHandler(async (req, res) => {
    try {
        const { stop_id } = req.params;
        console.log(`Received request for stop_id: ${stop_id}`);

        // Step 1: Find stoptimes for the given stop_id
        const stoptimes = await StopTime.find({ stop_id });
        console.log(`Step 1: Found ${stoptimes.length} stoptimes for stop_id ${stop_id}`, stoptimes);

        if (!stoptimes.length) {
            return res.status(404).json({ message: "No stoptimes found for this stop" });
        }

        // Step 2: Extract trip_ids
        const tripIds = stoptimes.map(st => st.trip_id);
        console.log(`Step 2: Extracted trip_ids:`, tripIds);

        // Step 3: Find trips matching those trip_ids
        const trips = await Trip.find({ trip_id: { $in: tripIds } });
        console.log(`Step 3: Found ${trips.length} trips for trip_ids`, trips);

        if (!trips.length) {
            return res.status(404).json({ message: "No trips found for these stoptimes" });
        }

        // Step 4: Extract route_ids from trips
        const routeIds = trips.map(tr => tr.route_id);
        console.log(`Step 4: Extracted route_ids:`, routeIds);

        // Step 5: Find routes matching those route_ids
        const routes = await Route.find({ route_id: { $in: routeIds } });
        console.log(`Step 5: Found ${routes.length} routes for route_ids`, routes);

        if (!routes.length) {
            return res.status(404).json({ message: "No routes found for these trips" });
        }

        // Step 6: Send response
        console.log(`Step 6: Sending response with stoptimes, trips, and routes`);
        res.json({ stoptimes, trips, routes });

    } catch (error) {
        console.error(`Error occurred:`, error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = {
    getTrip,
};