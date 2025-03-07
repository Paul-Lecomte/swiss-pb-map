const express = require('express');
const tripController = require('../controller/tripController');
const router = express.Router();

// @desc     Get trip info
// @route    GET /api/trip/:_id
// @access   public
router.route('/:stop_id').get(tripController.getTrip);

// @desc     Get timetable for a given stop
// @route    GET /api/trip/timetable/:_id
// @access   public
router.route('/timetable/:stop_id').get(tripController.getTimetable);

// @desc     Get all the stops
// @route    GET /api/trip/all
// @access   public
router.route('/all').get(tripController.getAllStops);

module.exports = router;