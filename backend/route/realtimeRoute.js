const express = require('express');
const router = express.Router();
const { getTripUpdates, getInterpolatedRealtime, getTripUpdatesByTripIds, getRealtimeCacheStatsEndpoint } = require('../controller/realtimeController');

// @desc     Get parsed GTFS-RT TripUpdates
// @route    GET /api/realtime/trip-updates
// @access   public
router.get('/trip-updates', getTripUpdates);

// @desc     Get interpolated vehicle positions as GeoJSON for bbox
// @route    GET /api/realtime/interpolated?bbox=minLng,minLat,maxLng,maxLat
// @access   public
router.get('/interpolated', getInterpolatedRealtime);

// Only POST for large sets via JSON body
// @desc     Get parsed GTFS-RT TripUpdates by trip IDs (cache-based)
// @route    POST /api/realtime/trip-updates/by-trip
// @access   public
router.post('/trip-updates/by-trip', getTripUpdatesByTripIds);

// @desc     Cache stats for realtime
// @route    GET /api/realtime/cache-stats
// @access   public
router.get('/cache-stats', getRealtimeCacheStatsEndpoint);

// @desc     Cache stats alias under trip-updates path
// @route    GET /api/realtime/trip-updates/cache-stats
// @access   public
router.get('/trip-updates/cache-stats', getRealtimeCacheStatsEndpoint);

module.exports = router;
