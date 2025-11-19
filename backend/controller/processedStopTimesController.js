const ProcessedStopTimes = require('../model/processedStopTimesModel');

// GET /api/trip/processed/:trip_id
exports.getProcessedStopTimesByTripId = async (req, res) => {
    try {
        const tripId = req.params.trip_id;
        if (!tripId) return res.status(400).json({ error: 'trip_id required' });

        const doc = await ProcessedStopTimes.findOne({ trip_id: tripId }).lean();
        if (!doc) return res.status(404).json({ error: 'Processed stop times not found for trip_id' });

        // Compact payload: only first/last stop, direction_id, trip_id, route start/stop times, route_id
        const firstStop = (doc.stop_times && doc.stop_times.length) ? doc.stop_times[0] : null;
        const lastStop = (doc.stop_times && doc.stop_times.length) ? doc.stop_times[doc.stop_times.length - 1] : null;

        const payload = {
            trip_id: doc.trip_id,
            route_id: doc.route_id,
            direction_id: doc.direction_id,
            route_start_time: doc.route_start_time,
            route_stop_time: doc.route_stop_time,
            first_stop: firstStop ? {
                stop_id: firstStop.stop_id,
                arrival_time: firstStop.arrival_time,
                departure_time: firstStop.departure_time,
                stop_sequence: firstStop.stop_sequence
            } : null,
            last_stop: lastStop ? {
                stop_id: lastStop.stop_id,
                arrival_time: lastStop.arrival_time,
                departure_time: lastStop.departure_time,
                stop_sequence: lastStop.stop_sequence
            } : null,
            // include minimal calendar info for UI decisions if needed
            calendar: doc.calendar || null
        };

        return res.json(payload);
    } catch (err) {
        console.error('[processedStopTimesController] error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

