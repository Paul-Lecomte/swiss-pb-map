const express = require('express');
const router = express.Router();
const { getStopsInBbox } = require('../controller/stopController');


router.get('/stops-in-bbox', getStopsInBbox);

module.exports = router;
