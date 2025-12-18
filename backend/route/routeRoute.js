const express = require('express');
const router = express.Router();
const { getRoutesInBbox, getRouteGeometry, getRouteGeometryByTrip } = require('../controller/routeController');

// @desc     Get routes in bounding box
// @route    GET /api/routes/routes-in-bbox
// @access   public
router.get('/routes-in-bbox', getRoutesInBbox);

// @desc     Get full route geometry and schedules
// @route    GET /api/routes/geometry/:route_id
// @access   public
router.get('/geometry/:route_id', getRouteGeometry);

// @desc     Get full route geometry by trip_id
// @route    GET /api/routes/geometry-by-trip/:trip_id
// @access   public
router.get('/geometry-by-trip/:trip_id', getRouteGeometryByTrip);

module.exports = router;
