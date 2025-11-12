const express = require('express');
const router = express.Router();
const { getTripUpdates, getInterpolatedRealtime } = require('../controller/realtimeController');

// @desc     Get parsed GTFS-RT TripUpdates
// @route    GET /api/realtime/trip-updates
// @access   public
router.get('/trip-updates', getTripUpdates);

// @desc     Get interpolated vehicle positions as GeoJSON for bbox
// @route    GET /api/realtime/interpolated?bbox=minLng,minLat,maxLng,maxLat
// @access   public
router.get('/interpolated', getInterpolatedRealtime);

module.exports = router;

