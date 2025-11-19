const ProcessedStopTimes = require('../model/processedStopTimesModel');

// GET /api/trip/processed/:trip_id
exports.getProcessedStopTimesByTripId = async (req, res) => {
    try {
        const tripId = req.params.trip_id;
        if (!tripId) return res.status(400).json({ error: 'trip_id required' });

        const doc = await ProcessedStopTimes.findOne({ trip_id: tripId }).lean();
        if (!doc) return res.status(404).json({ error: 'Processed stop times not found for trip_id' });

        // Return the full document as requested (no compaction)
        return res.json(doc);
    } catch (err) {
        console.error('[processedStopTimesController] error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
