const express = require('express');
const router = express.Router();
const { getTripUpdates, getInterpolatedRealtime, getTripUpdatesByTripIds } = require('../controller/realtimeController');

// @desc     Get parsed GTFS-RT TripUpdates
// @route    GET /api/realtime/trip-updates
// @access   public
router.get('/trip-updates', getTripUpdates);

// @desc     Get interpolated vehicle positions as GeoJSON for bbox
// @route    GET /api/realtime/interpolated?bbox=minLng,minLat,maxLng,maxLat
// @access   public
router.get('/interpolated', getInterpolatedRealtime);

// @desc     Get parsed GTFS-RT TripUpdates by trip IDs
// @route    POST /api/realtime/trip-updates/by-trip
// @access   public
router.post('/trip-updates/by-trip', getTripUpdatesByTripIds);

// @desc     Get parsed GTFS-RT TripUpdates by trip IDs
// @route    GET /api/realtime/trip-updates/by-trip
// @access   public
router.get('/trip-updates/by-trip', getTripUpdatesByTripIds);

module.exports = router;
