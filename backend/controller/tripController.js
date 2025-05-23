const asyncHandler = require("express-async-handler");
const StopTime = require("../model/stopTimesModel");
const Trip = require("../model/tripsModel");
const Route = require("../model/routesModel");
const Stop = require("../model/stopsModel");
const fetchGTFSData = require("../utils/gtfsRealTime");
const ProcessedStop = require("../model/processedStopsModel");

const getAllStops = asyncHandler(async (req, res) => {
    try {
        const stops = await Stop.find({});
        res.status(200).json(stops);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stops', error: error.message });
    }
})

const getAllProcessedStops = asyncHandler(async (req, res) => {
    try {
        const processedStops = await ProcessedStop.find({});
        res.status(200).json(processedStops);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stops', error: error.message });
    }
})

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
        const { stop_id } = req.params;
        const currentTime = new Date().toTimeString().split(" ")[0]; // Format HH:MM:SS

        // Fetch GTFS Realtime updates
        const realtimeUpdates = await fetchGTFSData();

        // Step 1: Find static stoptimes
        let stoptimes = await StopTime.find({ stop_id }).sort({ stop_sequence: 1 });

        if (!stoptimes.length) {
            return res.status(404).json({ message: "No stoptimes found for this stop" });
        }

        // Step 2: Find the closest upcoming trip
        let ongoingStoptime = stoptimes.find(st => st.departure_time >= currentTime);

        if (!ongoingStoptime) {
            return res.status(404).json({ message: "No active trips currently for this stop" });
        }

        const { trip_id } = ongoingStoptime;

        // Step 3: Find trip details
        const trip = await Trip.findOne({ trip_id });
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        // Step 4: Find route details
        const route = await Route.findOne({ route_id: trip.route_id });
        if (!route) return res.status(404).json({ message: "Route not found" });

        // Step 5: Find all stops for this trip
        let allStoptimes = await StopTime.find({ trip_id }).sort({ stop_sequence: 1 });

        // Step 6: Find stop details
        const stopIds = allStoptimes.map(st => st.stop_id);
        const stops = await Stop.find({ stop_id: { $in: stopIds } });

        // Step 7: Apply GTFS Realtime Updates
        const updatedStoptimes = allStoptimes.map(st => {
            const update = realtimeUpdates.find(rt =>
                rt.tripUpdate?.trip?.tripId === st.trip_id &&
                rt.tripUpdate?.stopTimeUpdate?.some(su => su.stopId === st.stop_id)
            );

            if (update) {
                const stopUpdate = update.tripUpdate.stopTimeUpdate.find(su => su.stopId === st.stop_id);
                return {
                    ...st.toObject(),
                    arrival_time: stopUpdate?.arrival?.time || st.arrival_time,
                    departure_time: stopUpdate?.departure?.time || st.departure_time,
                    delay: stopUpdate?.arrival?.delay || 0
                };
            }
            return { ...st.toObject(), delay: 0 };
        });

        // Step 8: Attach stop names
        const stoptimesWithStopNames = updatedStoptimes.map(st => {
            const stop = stops.find(s => s.stop_id === st.stop_id);
            return {
                stop_id: st.stop_id,
                stop_name: stop ? stop.stop_name : "Unknown Stop",
                arrival_time: st.arrival_time,
                departure_time: st.departure_time,
                delay: st.delay,
                stop_lat: stop?.stop_lat,
                stop_lon: stop?.stop_lon,
                stop_sequence: st.stop_sequence,
            };
        });

        // Step 9: Sort stops
        stoptimesWithStopNames.sort((a, b) => a.stop_sequence - b.stop_sequence);

        // Step 10: Split past, current, and future stops
        const allStops = stoptimesWithStopNames.filter(st => st.arrival_time >= currentTime);
        const currentStop = stoptimesWithStopNames.find(st => st.stop_id === stop_id) || null;

        // Step 11: Send structured response
        res.json({
            route: {
                route_id: route.route_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                trip_headsign: trip.trip_headsign,
            },
            current_stop: currentStop,
            all_the_stops: allStops,
        });

    } catch (error) {
        console.error("Error in getTimetable:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

const searchStopByName = asyncHandler(async (req, res) => {
    try {
        const { name } = req.query; // Extract query parameter
        if (!name) {
            return res.status(400).json({ message: "Search query is required" });
        }

        const stop = await Stop.find({ stop_name: { $regex: name, $options: 'i' } });
        res.status(200).json(stop);
    } catch (error) {
        res.status(500).json({ message: 'Search failed', error: error.message });
    }
});


// Currently the results is correct but it is not streamed to the client
const stopsPosAndRoutes = asyncHandler(async (req, res) => {
    try {
        console.log("🚀 Starting streamed stops API");

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Transfer-Encoding", "chunked");
        res.flushHeaders();

        res.write("[");
        let isFirst = true;

        console.log("🔄 Loading trips...");
        const trips = await Trip.find();
        console.log(`✅ Loaded ${trips.length} trips`);

        console.log("🔄 Loading routes...");
        const routes = await Route.find();
        console.log(`✅ Loaded ${routes.length} routes`);

        const tripMap = new Map(trips.map(t => [t.trip_id, t]));
        const routeMap = new Map(routes.map(r => [r.route_id, r]));

        console.log("🔄 Creating stop cursor...");
        const stopCursor = Stop.find().cursor();
        let stopCounter = 0;

        for await (const stop of stopCursor) {
            stopCounter++;
            if (stopCounter % 100 === 0) console.log(`📍 Processing stop #${stopCounter}`);

            // ⚡ Only fetch StopTimes for the current stop
            const stoptimesForStop = await StopTime.find({ stop_id: stop.stop_id });

            const tripIds = [...new Set(stoptimesForStop.map(st => st.trip_id))];
            const tripsForStop = tripIds.map(id => tripMap.get(id)).filter(Boolean);

            const routeIds = [...new Set(tripsForStop.map(trip => trip.route_id))];
            const routesForStop = routeIds.map(id => routeMap.get(id)).filter(Boolean);

            const result = {
                stop_id: stop.stop_id,
                stop_name: stop.stop_name,
                stop_lat: stop.stop_lat,
                stop_lon: stop.stop_lon,
                trips: tripsForStop.map(trip => ({
                    trip_id: trip.trip_id,
                    trip_headsign: trip.trip_headsign,
                    route_id: trip.route_id
                })),
                routes: routesForStop.map(route => ({
                    route_id: route.route_id,
                    route_short_name: route.route_short_name,
                    route_long_name: route.route_long_name
                }))
            };

            const jsonChunk = (isFirst ? "" : ",") + JSON.stringify(result);

            try {
                res.write(jsonChunk);
                isFirst = false;
                if (res.flush) res.flush();
            } catch (writeErr) {
                console.error(`❌ Write failed for stop ${stop.stop_id}`, writeErr);
            }
        }

        console.log("✅ Finished all stops. Closing stream.");
        res.write("]");
        res.end();
    } catch (error) {
        console.error("🔥 Fatal error in streamed stops API:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Server_error", error: error.message });
        } else {
            res.end();
        }
    }
})

module.exports = {
    getTrip,
    getTimetable,
    getAllStops,
    searchStopByName,
    stopsPosAndRoutes,
    getAllProcessedStops
};