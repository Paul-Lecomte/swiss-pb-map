const asyncHandler = require("express-async-handler");
const StopTime = require("../model/stopTimesModel");
const Trip = require("../model/tripsModel");
const Route = require("../model/routesModel");
const Stop = require("../model/stopsModel");
const fetchGTFSData = require("../utils/gtfsRealTime");

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

const getTimetable = asyncHandler(async (req, res) => {
    try {
        const { stop_id, date } = req.params;
        const currentTime = new Date().toTimeString().split(" ")[0]; // Format HH:MM:SS

        // Step 1: Find stoptimes for the given stop_id
        const stoptimes = await StopTime.find({ stop_id }).sort({ stop_sequence: 1 });

        if (!stoptimes.length) {
            return res.status(404).json({ message: "No stoptimes found for this stop" });
        }

        // Step 2: Find the first ongoing trip for this stop (closest future trip)
        const ongoingStoptime = stoptimes.find(st => st.departure_time >= currentTime);

        if (!ongoingStoptime) {
            return res.status(404).json({ message: "No active trips currently for this stop" });
        }

        const { trip_id } = ongoingStoptime;

        // Step 3: Find the trip details
        const trip = await Trip.findOne({ trip_id });
        if (!trip) {
            return res.status(404).json({ message: "Trip not found" });
        }

        // Step 4: Find the route details
        const route = await Route.findOne({ route_id: trip.route_id });
        if (!route) {
            return res.status(404).json({ message: "Route not found" });
        }

        // Step 5: Find all stops for this trip, ordered by sequence
        const allStoptimes = await StopTime.find({ trip_id }).sort({ stop_sequence: 1 });

        // Step 6: Get stop details
        const stopIds = allStoptimes.map(st => st.stop_id);
        const stops = await Stop.find({ stop_id: { $in: stopIds } });

        // Step 7: Attach stop names to stoptimes and sort by stop_sequence
        const stoptimesWithStopNames = allStoptimes.map(st => {
            const stop = stops.find(s => s.stop_id === st.stop_id);
            return {
                stop_id: st.stop_id,
                stop_name: stop ? stop.stop_name : "Unknown Stop",
                arrival_time: st.arrival_time,
                departure_time: st.departure_time,
                stop_lat: stop.stop_lat,
                stop_lon: stop.stop_lon,
                parent_station: st.parent_station,
                stop_sequence: st.stop_sequence,
            };
        });

        // Step 8: Sort the stops based on the stop_sequence
        stoptimesWithStopNames.sort((a, b) => a.stop_sequence - b.stop_sequence);

        // Step 9: Split into past, current, and future stops
        const pastStops = stoptimesWithStopNames.filter(st => st.departure_time < currentTime);
        const futureStops = stoptimesWithStopNames.filter(st => st.arrival_time >= currentTime);
        const currentStop = stoptimesWithStopNames.find(st => st.stop_id === stop_id) || null;

        // Step 10: Send structured response
        res.json({
            route: {
                route_id: route.route_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                trip_headsign: trip.trip_headsign,
            },
            past_stops: pastStops,
            current_stop: currentStop,
            future_stops: futureStops,
        });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = {
    getTrip,
    getTimetable
};