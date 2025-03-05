const express = require('express');
const tripController = require('../controller/tripController');
const router = express.Router();

// @desc     Get trip info
// @route    GET /api/trip/:_id
// @access   public
router.route('/:stop_id').get(tripController.getTrip);

module.exports = router;