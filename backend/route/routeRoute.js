const express = require('express');
const router = express.Router();
const { getRoutesInBbox } = require('../controller/routeController');

// @desc     Get routes in bounding box
// @route    GET /api/routes/routes-in-bbox
// @access   public
router.get('/routes-in-bbox', getRoutesInBbox);

module.exports = router;
