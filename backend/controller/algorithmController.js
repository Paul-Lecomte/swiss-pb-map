// backend/controller/algorithmController.js

const asyncHandler = require("express-async-handler");
const StopTime = require("../model/stopTimesModel");
const Transfer = require("../model/transfersModel");
const Stop = require("../model/stopsModel");

// Utilitaire pour convertir HH:MM:SS en secondes
function timeToSeconds(t) {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + (s || 0);
}

// Algorithme Dijkstra adapté GTFS avec logs
async function dijkstraGTFS(from_id, to_id, stoptimes, transfers, departure_time = "00:00:00") {
    const stopTimeMap = {};
    stoptimes.forEach(st => {
        if (!stopTimeMap[st.stop_id]) stopTimeMap[st.stop_id] = [];
        stopTimeMap[st.stop_id].push(st);
    });

    const transferMap = {};
    transfers.forEach(tr => {
        if (!transferMap[tr.from_stop_id]) transferMap[tr.from_stop_id] = [];
        transferMap[tr.from_stop_id].push(tr);
    });

    const queue = [[from_id, timeToSeconds(departure_time), []]];
    const visited = {};

    console.log(`Starting Dijkstra from ${from_id} to ${to_id} at ${departure_time}`);

    while (queue.length) {
        queue.sort((a, b) => a[1] - b[1]);
        const [currentStop, currentTime, path] = queue.shift();

        console.log(`Visiting stop ${currentStop} at time ${currentTime}`);

        if (visited[currentStop] && visited[currentStop] <= currentTime) continue;
        visited[currentStop] = currentTime;

        const newPath = [...path, { stop_id: currentStop, arrival_time: currentTime }];

        if (currentStop === to_id) {
            console.log(`Path found: ${JSON.stringify(newPath)}`);
            return newPath;
        }

        // Explorer les départs possibles depuis cet arrêt
        const departures = stopTimeMap[currentStop] || [];
        departures.forEach(st => {
            const depSec = timeToSeconds(st.departure_time);
            if (depSec >= currentTime) {
                console.log(`  Departure from ${currentStop} to ${st.stop_id} at ${st.departure_time} (depSec: ${depSec})`);
                queue.push([st.stop_id, timeToSeconds(st.arrival_time), newPath]);
            }
        });

        // Explorer les transferts possibles
        const possibleTransfers = transferMap[currentStop] || [];
        possibleTransfers.forEach(tr => {
            const transferArrival = currentTime + (tr.min_transfer_time || 0);
            console.log(`  Transfer from ${currentStop} to ${tr.to_stop_id} (min_transfer_time: ${tr.min_transfer_time})`);
            queue.push([tr.to_stop_id, transferArrival, newPath]);
        });
    }
    console.log("No path found.");
    return null;
}

const findFastestPath = asyncHandler(async (req, res) => {
    const { from_id, to_id } = req.params;
    const departure_time = req.query.departure_time || "00:00:00";

    console.log(`Received fastest path request: from ${from_id} to ${to_id} at ${departure_time}`);

    // Only load stoptimes within 2 hours of departure_time
    const depSec = timeToSeconds(departure_time);
    const windowStart = new Date(depSec * 1000).toISOString().substr(11, 8);
    const windowEnd = new Date((depSec + 2 * 3600) * 1000).toISOString().substr(11, 8);

    const stoptimes = await StopTime.find({
        departure_time: { $gte: windowStart, $lte: windowEnd }
    });
    const transfers = await Transfer.find({});

    const path = await dijkstraGTFS(from_id, to_id, stoptimes, transfers, departure_time);

    if (!path) {
        console.log("No path found, returning 404.");
        return res.status(404).json({ message: "Chemin non trouvé" });
    }

    const stopIds = path.map(p => p.stop_id);
    const stops = await Stop.find({ stop_id: { $in: stopIds } });
    const stopsMap = Object.fromEntries(stops.map(s => [s.stop_id, s]));

    const result = path.map(p => ({
        stop_id: p.stop_id,
        stop_name: stopsMap[p.stop_id]?.stop_name || "Unknown",
        arrival_time: new Date(p.arrival_time * 1000).toISOString().substr(11, 8)
    }));

    console.log(`Returning path: ${JSON.stringify(result)}`);
    res.json({ path: result });
});

module.exports = {
    findFastestPath,
};