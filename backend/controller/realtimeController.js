const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const { getParsedTripUpdates, gtfsHhmmssToSeconds, filterTripUpdatesByIds } = require('../utils/gtfsRealTime');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');
const { mapStopsToGeometry, interpolateBetweenCoords, computeProgress, clipPolylineToBBox } = require('../utils/interpolation');

// Match TripUpdate to static trip document
async function findStaticTripForUpdate(tu) {
    const trip = tu.trip || {};
    const { tripId, originalTripId, routeId, startTime } = trip;

    // 1 exact trip_id
    if (tripId) {
        const found = await ProcessedStopTimes.findOne({ trip_id: tripId }).lean();
        if (found) return { doc: found, method: 'trip_id' };
    }
    // 2 original_trip_id fallback
    if (originalTripId) {
        const foundOrig = await ProcessedStopTimes.findOne({ $or: [ { trip_id: originalTripId }, { original_trip_id: originalTripId } ] }).lean();
        if (foundOrig) return { doc: foundOrig, method: 'original_trip_id' };
    }
    // 3 heuristic routeId + startTime window (+/-10m)
    if (routeId && startTime) {
        const candidates = await ProcessedStopTimes.find({ route_id: routeId }).lean();
        const targetSecs = gtfsHhmmssToSeconds(startTime);
        let best = null;
        let bestAbsDiff = Infinity;
        for (const c of candidates) {
            if (!c.route_start_time) continue;
            const cSecs = gtfsHhmmssToSeconds(c.route_start_time);
            if (cSecs == null) continue;
            const diff = Math.abs(cSecs - targetSecs);
            if (diff <= 600 && diff < bestAbsDiff) { // within 10 minutes
                best = c;
                bestAbsDiff = diff;
            }
        }
        if (best) return { doc: best, method: 'heuristic_route_start_time' };
    }
    return null;
}

// Convert HH:MM:SS scheduled time to epoch seconds for a given date (YYYYMMDD)
function hhmmssToEpochForDate(hhmmss, dateStr){
    const date = DateTime.fromFormat(dateStr || DateTime.now().toFormat('yyyyLLdd'), 'yyyyLLdd', { zone: 'Europe/Zurich' });
    const [hh, mm, ss] = String(hhmmss || '00:00:00').split(':').map(Number);
    return Math.floor(date.set({ hour: hh||0, minute: mm||0, second: ss||0 }).toSeconds());
}

// Endpoint: trip updates raw
const getTripUpdates = asyncHandler(async (req, res) => {
    const { isRealtime, fetchedAt, tripUpdates } = await getParsedTripUpdates();
    res.json({ isRealtime, fetchedAt, tripUpdatesCount: tripUpdates.length, tripUpdates });
});

// Helper build predicted per-stop epoch seconds combining static and update
function buildPredictedTimes(staticTripDoc, tu) {
    const dateStr = (tu.trip && tu.trip.startDate) || DateTime.now().setZone('Europe/Zurich').toFormat('yyyyLLdd');
    const staticStops = staticTripDoc.stop_times || [];
    // Map scheduled times to epoch
    const scheduledEpochs = staticStops.map(st => hhmmssToEpochForDate(st.arrival_time || st.departure_time, dateStr));

    // Merge TripUpdate stopTimeUpdates
    const predicted = [...scheduledEpochs];
    (tu.stopTimeUpdates || []).forEach(stu => {
        const idx = typeof stu.stopSequence === 'number' ? staticStops.findIndex(s => s.stop_sequence === stu.stopSequence) : staticStops.findIndex(s => s.stop_id === stu.stopId);
        if (idx >= 0) {
            let epoch = null;
            if (stu.arrivalTimeSecs) epoch = Number(stu.arrivalTimeSecs);
            else if (stu.departureTimeSecs) epoch = Number(stu.departureTimeSecs);
            else if (stu.arrivalDelaySecs != null) epoch = scheduledEpochs[idx] + stu.arrivalDelaySecs;
            else if (stu.departureDelaySecs != null) epoch = scheduledEpochs[idx] + stu.departureDelaySecs;
            if (epoch) predicted[idx] = epoch;
        }
    });
    return predicted;
}

function averageDelaySeconds(staticTripDoc, tu, predictedTimes) {
    const staticStops = staticTripDoc.stop_times || [];
    const dateStr = (tu.trip && tu.trip.startDate) || DateTime.now().setZone('Europe/Zurich').toFormat('yyyyLLdd');
    let delays = [];
    (tu.stopTimeUpdates || []).forEach(stu => {
        const idx = typeof stu.stopSequence === 'number' ? staticStops.findIndex(s => s.stop_sequence === stu.stopSequence) : staticStops.findIndex(s => s.stop_id === stu.stopId);
        if (idx >= 0) {
            const sched = hhmmssToEpochForDate(staticStops[idx].arrival_time || staticStops[idx].departure_time, dateStr);
            const pred = predictedTimes[idx];
            if (sched && pred) delays.push(pred - sched);
        }
    });
    if (!delays.length) return 0;
    return delays.reduce((a,b)=>a+b,0)/delays.length;
}

// Endpoint: interpolated vehicles
const getInterpolatedRealtime = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: 'bbox missing' });
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    const { isRealtime, fetchedAt, tripUpdates } = await getParsedTripUpdates();

    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    }).limit(200).lean();

    const routeIds = routes.map(r => r.route_id);
    const stopTimesDocs = await ProcessedStopTimes.find({ route_id: { $in: routeIds } }).lean();
    const stopTimesByRoute = {};
    stopTimesDocs.forEach(doc => {
        if (!stopTimesByRoute[doc.route_id]) stopTimesByRoute[doc.route_id] = [];
        stopTimesByRoute[doc.route_id].push(doc);
    });

    const now = DateTime.now().setZone('Europe/Zurich');
    const nowEpoch = Math.floor(now.toSeconds());

    const features = [];

    for (const route of routes) {
        const relatedTrips = stopTimesByRoute[route.route_id] || [];
        if (!relatedTrips.length) continue;
        const stopsMapping = mapStopsToGeometry(route.geometry.coordinates, route.stops);
        const vehicles = [];
        const routeTripUpdates = tripUpdates.filter(t => t.trip.routeId === route.route_id);
        for (const tu of routeTripUpdates) {
            let match = await findStaticTripForUpdate(tu);
            if (!match) {
                // Debug unmatched
                console.debug(`[RT] No static match for TripUpdate tripId=${tu.trip.tripId} routeId=${tu.trip.routeId}`);
                continue;
            }
            const staticTrip = match.doc;
            const predictedTimes = buildPredictedTimes(staticTrip, tu);
            const progress = computeProgress(predictedTimes, nowEpoch);
            if (!progress) continue;
            const { prevStopIdx, nextStopIdx, fraction } = progress;
            const prevMap = stopsMapping[prevStopIdx];
            const nextMap = stopsMapping[nextStopIdx];
            if (!prevMap || !nextMap) continue;
            const targetDist = prevMap.distanceAlong + fraction * (nextMap.distanceAlong - prevMap.distanceAlong);
            const position = interpolateBetweenCoords(route.geometry.coordinates, prevMap.distanceAlong, nextMap.distanceAlong, targetDist);
            const delaySec = averageDelaySeconds(staticTrip, tu, predictedTimes);
            vehicles.push({
                trip_id: staticTrip.trip_id,
                position,
                progress: fraction,
                prev_stop_id: route.stops[prevStopIdx]?.stop_id,
                next_stop_id: route.stops[nextStopIdx]?.stop_id,
                delaySeconds: Math.round(delaySec)
            });
        }
        if (!vehicles.length) continue;
        const avgDelay = vehicles.reduce((a,v)=>a+v.delaySeconds,0)/vehicles.length;
        // Clip geometry to bbox with small padding to keep continuity across edges
        const clippedCoords = clipPolylineToBBox(route.geometry.coordinates, [minLng, minLat, maxLng, maxLat], 0.0005);
        const geometry = { type: route.geometry.type, coordinates: roundCoords(clippedCoords) };
        const baseProps = {
            route_id: route.route_id,
            route_short_name: route.route_short_name,
            route_type: route.route_type,
            route_color: route.route_color,
            route_text_color: route.route_text_color,
            delayMinutes: avgDelay / 60,
            vehicles,
            isRealtime,
            fetchedAt
        };
        const props = compact ? baseProps : {
            ...baseProps,
            route_long_name: route.route_long_name,
            route_desc: route.route_desc,
        };
        features.push({
            type: 'Feature',
            geometry,
            properties: props
        });
    }

    res.json({ type: 'FeatureCollection', features, meta: { isRealtime, fetchedAt, routeCount: routes.length, featureCount: features.length } });
});

// Endpoint: trip updates by tripIds
const getTripUpdatesByTripIds = asyncHandler(async (req, res) => {
    const body = req.method === 'GET' ? req.query : req.body;
    let tripIds = body.tripIds || body.tripids || body.ids;
    if (typeof tripIds === 'string') {
        try { tripIds = JSON.parse(tripIds); } catch {}
    }
    if (!Array.isArray(tripIds) || tripIds.length === 0) {
        return res.status(400).json({ error: 'tripIds required (array)' });
    }
    const { isRealtime, fetchedAt, tripUpdates, isCached, cacheAgeMs, isStale, rateLimited, error } = await getParsedTripUpdates();
    const filtered = filterTripUpdatesByIds(tripUpdates, tripIds);
    res.json({ isRealtime, isCached, isStale, cacheAgeMs, rateLimited, error, fetchedAt, tripUpdatesCount: filtered.length, tripUpdates: filtered });
});

module.exports = { getTripUpdates, getInterpolatedRealtime, getTripUpdatesByTripIds };
