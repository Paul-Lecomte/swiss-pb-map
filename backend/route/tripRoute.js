const express = require('express');
const tripController = require('../controller/tripController');
const router = express.Router();

// @desc     Get trip info
// @route    GET /api/trip/:_id
// @access   public
router.route('/:_id').get(tripController.getTrip);