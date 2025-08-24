// This controller implements Dijkstra's algorithm for finding the fastest path in a GTFS dataset.
const asyncHandler = require("express-async-handler");
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { streamArray } = require('stream-json/streamers/StreamArray');
const Transfer = require("../model/transfersModel");
const Stop = require("../model/stopsModel");
const Trip = require("../model/tripsModel");
const Calendar = require("../model/calendarModel");
const CalendarDate = require("../model/calendarDatesModel");

function timeToSeconds(t) {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + (s || 0);
}

function getDayOfWeek(dateStr) {
    return new Date(dateStr).getDay();
}

class MinHeap {
    constructor() { this.heap = []; }
    push(item) { this.heap.push(item); this.heap.sort((a, b) => a[0] - b[0]); }
    pop() { return this.heap.shift(); }
    size() { return this.heap.length; }
}

function extendPath(path, currentStop, currentTime, departureTime, tripId, isTransfer = false) {
    if (path.some(p => p.stop_id === currentStop && p.trip_id === tripId)) return path;
    const updatedPath = [...path];
    if (updatedPath.length) updatedPath[updatedPath.length - 1].departure_time_from_stop = departureTime;
    updatedPath.push({
        stop_id: currentStop,
        arrival_time_at_stop: currentTime,
        departure_time_from_stop: null,
        trip_id: tripId,
        is_transfer: isTransfer
    });
    return updatedPath;
}

async function dijkstraGTFS(from_id, to_id, stoptimes, transfers, departure_time_str = "00:00:00") {
    const initialDepartureSeconds = timeToSeconds(departure_time_str);
    const MAX_TRAVEL_SECONDS = 6 * 60 * 60; // 6 hours cap to prevent unbounded searches
    const MAX_EXPANSIONS = 500000; // safety cap on queue pops
    const MAX_BOARDINGS_PER_VISIT = 50; // limit number of departures considered per stop visit

    const latestAllowedTime = initialDepartureSeconds + MAX_TRAVEL_SECONDS;

    const tripStopTimesMap = new Map();
    const tripSequenceMap = new Map();
    const stopDeparturesMap = new Map();
    const transferMap = new Map();
    const tripSeqToStopTimeMap = new Map();

    // Helper: binary search first index with departure_time >= t
    function lowerBoundDepartures(list, t) {
        let lo = 0, hi = list.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const dep = timeToSeconds(list[mid].departure_time);
            if (dep < t) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    // Build maps in a single pass
    stoptimes.forEach(st => {
        if (!tripStopTimesMap.has(st.trip_id)) {
            tripStopTimesMap.set(st.trip_id, new Map());
            tripSequenceMap.set(st.trip_id, []);
            tripSeqToStopTimeMap.set(st.trip_id, new Map());
        }
        tripStopTimesMap.get(st.trip_id).set(st.stop_id, st);
        tripSequenceMap.get(st.trip_id).push(st.stop_sequence);
        tripSeqToStopTimeMap.get(st.trip_id).set(st.stop_sequence, st);

        if (!stopDeparturesMap.has(st.stop_id)) stopDeparturesMap.set(st.stop_id, []);
        stopDeparturesMap.get(st.stop_id).push(st);
    });

    tripSequenceMap.forEach(seq => seq.sort((a, b) => a - b));
    stopDeparturesMap.forEach(list =>
        list.sort((a, b) => timeToSeconds(a.departure_time) - timeToSeconds(b.departure_time))
    );

    transfers.forEach(tr => {
        if (!transferMap.has(tr.from_stop_id)) transferMap.set(tr.from_stop_id, []);
        transferMap.get(tr.from_stop_id).push(tr);
    });

    const queue = new MinHeap();
    queue.push([initialDepartureSeconds, from_id, [], null]);
    const visited = new Map();
    let expansions = 0;

    while (queue.size()) {
        const [currentTime, currentStop, path, currentTripId] = queue.pop();
        if (currentTime > latestAllowedTime) continue; // prune paths beyond max travel time
        expansions++;
        if (expansions > MAX_EXPANSIONS) break; // safety break

        const visitedKey = `${currentStop}-${currentTripId || 'null'}`;
        if (visited.has(visitedKey) && visited.get(visitedKey) <= currentTime) continue;
        visited.set(visitedKey, currentTime);

        const currentPath = extendPath(path, currentStop, currentTime, null, currentTripId);

        if (currentStop === to_id) return currentPath;

        // Continue riding current trip
        if (currentTripId !== null) {
            const tripStops = tripStopTimesMap.get(currentTripId);
            const currentStoptime = tripStops?.get(currentStop);
            if (currentStoptime) {
                const seq = currentStoptime.stop_sequence;
                const sequences = tripSequenceMap.get(currentTripId);
                const nextSeqIndex = sequences.indexOf(seq) + 1;
                if (nextSeqIndex < sequences.length) {
                    const nextStop = tripSeqToStopTimeMap.get(currentTripId)?.get(sequences[nextSeqIndex]);
                    if (nextStop) {
                        const depTime = Math.max(currentTime, timeToSeconds(currentStoptime.departure_time));
                        const arrTime = timeToSeconds(nextStop.arrival_time);
                        if (depTime <= arrTime && arrTime <= latestAllowedTime) {
                            const newPath = extendPath(path, currentStop, currentTime, depTime, currentTripId);
                            queue.push([arrTime, nextStop.stop_id, newPath, currentTripId]);
                        }
                    }
                }
            }
        }

        // Transfers from this stop (only if within time window)
        const transfersFromStop = transferMap.get(currentStop) || [];
        for (const tr of transfersFromStop) {
            const arrTime = currentTime + (tr.min_transfer_time || 0);
            if (arrTime > latestAllowedTime) continue;
            const newPath = extendPath(path, currentStop, currentTime, currentTime, null, true);
            queue.push([arrTime, tr.to_stop_id, newPath, null]);
        }

        // Board new trips only when not currently on a trip
        if (currentTripId === null) {
            const departures = stopDeparturesMap.get(currentStop) || [];
            if (departures.length) {
                let startIdx = lowerBoundDepartures(departures, currentTime);
                let explored = 0;
                for (let i = startIdx; i < departures.length && explored < MAX_BOARDINGS_PER_VISIT; i++, explored++) {
                    const st = departures[i];
                    const depTime = timeToSeconds(st.departure_time);
                    if (depTime < currentTime) continue;
                    if (depTime > latestAllowedTime) break;

                    // When boarding a trip from the current stop, advance to the next stop in the trip
                    const sequences = tripSequenceMap.get(st.trip_id);
                    if (!sequences) continue;
                    const idx = sequences.indexOf(st.stop_sequence);
                    const nextIdx = idx + 1;
                    if (nextIdx < sequences.length) {
                        const nextStopSt = tripSeqToStopTimeMap.get(st.trip_id)?.get(sequences[nextIdx]);
                        if (!nextStopSt) continue;
                        const arrTime = timeToSeconds(nextStopSt.arrival_time);
                        if (arrTime >= depTime && arrTime <= latestAllowedTime) {
                            const newPath = extendPath(path, currentStop, currentTime, depTime, st.trip_id);
                            queue.push([arrTime, nextStopSt.stop_id, newPath, st.trip_id]);
                        }
                    }
                }
            }
        }
    }
    return null;
}

const findFastestPath = asyncHandler(async (req, res) => {
    const { from_id, to_id } = req.params;
    const departure_time = req.query.departure_time || "00:00:00";
    const departure_date = req.query.departure_date;

    if (!departure_date) {
        return res.status(400).json({ message: "Date de départ (departure_date) requise au format YYYY-MM-DD" });
    }

    const dayMap = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayOfWeek = dayMap[getDayOfWeek(departure_date)];

    const baseCalendars = await Calendar.find({ [dayOfWeek]: 1 });
    const exceptions = await CalendarDate.find({ date: departure_date });

    const removed = exceptions.filter(e => e.exception_type === 2).map(e => e.service_id);
    const added = exceptions.filter(e => e.exception_type === 1).map(e => e.service_id);

    const baseServiceIds = baseCalendars.map(c => c.service_id).filter(id => !removed.includes(id));
    const allServiceIds = [...new Set([...baseServiceIds, ...added])];

    const activeTrips = await Trip.find({ service_id: { $in: allServiceIds } });
    const activeTripIds = activeTrips.map(t => t.trip_id);

    // Reading StopTime from the local file in streaming with fallback if error "Top-level object should be an array"
    const stoptimes = [];
    const stoptimesPath = path.join(__dirname, '../data/stoptimes.json');
    const activeTripIdSet = new Set(activeTripIds);

    // Helper for NDJSON/line-by-line fallback parsing
    async function parseLineByLine(filePath) {
        await new Promise((resolve2, reject2) => {
            const rl = readline.createInterface({
                input: fs.createReadStream(filePath, { encoding: 'utf8' }),
                crlfDelay: Infinity,
            });
            rl.on('line', (line) => {
                const s = (line || '').trim();
                if (!s || s === '[' || s === ']' || s === ',') return;
                const trimmed = s.endsWith(',') ? s.slice(0, -1) : s;
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj && activeTripIdSet.has(obj.trip_id)) {
                        stoptimes.push(obj);
                    }
                } catch (e) {
                    // Ignore unparsable lines
                }
            });
            rl.on('close', resolve2);
            rl.on('error', reject2);
        });
    }

    try {
        await new Promise((resolve, reject) => {
            const pipeline = fs.createReadStream(stoptimesPath)
                .pipe(streamArray());
            pipeline.on('data', ({ value }) => {
                if (activeTripIdSet.has(value.trip_id)) {
                    stoptimes.push(value);
                }
            });
            pipeline.on('end', resolve);
            pipeline.on('error', reject);
        });
    } catch (err) {
        if (err && /Top-level object should be an array\./i.test(err.message || '')) {
            // Try full parse first
            try {
                const content = fs.readFileSync(stoptimesPath, 'utf8');
                const json = JSON.parse(content);
                let arr = Array.isArray(json)
                    ? json
                    : (json && Array.isArray(json.stoptimes))
                        ? json.stoptimes
                        : (json && Array.isArray(json.data))
                            ? json.data
                            : (json && Array.isArray(json.items))
                                ? json.items
                                : null;
                if (arr) {
                    for (const value of arr) {
                        if (value && activeTripIdSet.has(value.trip_id)) {
                            stoptimes.push(value);
                        }
                    }
                } else {
                    // Fall back to line-by-line parsing
                    await parseLineByLine(stoptimesPath);
                }
            } catch (parseErr) {
                // Fall back to line-by-line parsing if full parse failed
                await parseLineByLine(stoptimesPath);
            }
        } else {
            // Unknown error, rethrow
            throw err;
        }
    }

    const transfers = await Transfer.find({});

    const pathResult = await dijkstraGTFS(from_id, to_id, stoptimes, transfers, departure_time);

    if (!pathResult || pathResult.length === 0) {
        return res.status(404).json({ message: "Aucun chemin trouvé" });
    }

    if (pathResult.length > 100000) {
        return res.status(413).json({ message: "Chemin trop long, potentiellement cyclique" });
    }

    // Récupère les stops nécessaires
    const stopIds = [...new Set(pathResult.map(p => p.stop_id))];
    const stops = await Stop.find({ stop_id: { $in: stopIds } });
    const stopMap = new Map(stops.map(s => [s.stop_id, s]));

    // Début du streaming JSON
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.write('{"path":[');

    for (let i = 0; i < pathResult.length; i++) {
        const p = pathResult[i];
        const obj = {
            stop_id: p.stop_id,
            stop_name: stopMap.get(p.stop_id)?.stop_name || "Inconnu",
            arrival_time: new Date(p.arrival_time_at_stop * 1000).toISOString().substr(11, 8),
            departure_time: p.departure_time_from_stop
                ? new Date(p.departure_time_from_stop * 1000).toISOString().substr(11, 8)
                : null,
            trip_id: p.trip_id,
            is_transfer: p.is_transfer || false,
        };
        res.write((i > 0 ? ',' : '') + JSON.stringify(obj));
    }

    res.write(']}');
    res.end();
});

module.exports = {
    findFastestPath,
};