const express = require('express');
const algorithm = require('../controller/algorithmController');
const router = express.Router();

// @desc     Get fastest path between two stops
// @route    GET /api/fastest_path/:from_id/:to_id?departure_time=HH:MM:SS
// @access   public
router.route('/:from_id/:to_id').get(algorithm.findFastestPath);

module.exports = router;