const express = require('express');
const tripController = require('../controller/tripController');
const router = express.Router();

// @desc     Get trip info
// @route    GET /api/trip/:_id
// @access   public
router.route('/id/:stop_id').get(tripController.getTrip);

// @desc     Get timetable for a given stop
// @route    GET /api/trip/timetable/:_id
// @access   public
router.route('/timetable/:stop_id').get(tripController.getTimetable);

// @desc     Get all the stops
// @route    GET /api/trip/all
// @access   public
router.route('/all').get(tripController.getAllStops);

// @desc     Search stop by name
// @route    GET /api/trip/search
// @access   public
router.route('/search').get(tripController.searchStopByName);

// @desc     Get all the stops and their trips
// @route    GET /api/trip/stopspos
// @access   public
router.route('/all_processed_stop').get(tripController.getAllProcessedStops);

// @desc     Get all the stops and their trips
// @route    GET /api/trip/stopspos
// @access   public
//router.route('/stopspos').get(tripController.stopsPosAndRoutes);

module.exports = router;