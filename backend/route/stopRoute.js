const express = require('express');
const router = express.Router();
const { getStopsInBbox , searchProcessedStops} = require('../controller/stopController');

// @desc     Get stops in bounding box
// @route    GET /api/stops/stops-in-bbox
// @access   public
router.get('/stops-in-bbox', getStopsInBbox);

// @desc     Get stops by search query
// @route    GET /api/stops/search-stops
// @access   public
router.get('/search-stops', searchProcessedStops);

module.exports = router;
