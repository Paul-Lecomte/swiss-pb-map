const axios = require('axios');
const gtfsRealtimeBindings = require('gtfs-realtime-bindings');

const API_URL = 'https://api.opentransportdata.swiss/la/gtfs-rt';
const TOKEN = process.env.REALTIME_API_TOKEN;

// Cache for the feed
let cachedEntities = [];
let lastFetchTime = 0;
const CACHE_DURATION_MS = 12_000; // 12 seconds = max 5 calls/min

async function fetchGTFSFeed() {
    const now = Date.now();
    if (now - lastFetchTime < CACHE_DURATION_MS && cachedEntities.length) {
        console.log(`[GTFS-RT] Returning cached feed (${cachedEntities.length} entities)`);
        return cachedEntities;
    }

    try {
        console.log(`[GTFS-RT] Fetching feed from API at ${new Date().toISOString()}`);

        const response = await axios.get(API_URL, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'User-Agent': 'RailQuest',
                'Content-Type': 'application/octet-stream'
            },
            responseType: 'arraybuffer',
            validateStatus: null // prevent axios from throwing on non-200
        });

        console.log(`[GTFS-RT] Response status: ${response.status}`);
        console.log(`[GTFS-RT] Response length: ${response.data.length} bytes`);

        if (response.status !== 200) {
            console.error(`[GTFS-RT] Non-200 response, returning cached feed (${cachedEntities.length} entities)`);
            return cachedEntities;
        }

        const buffer = Buffer.from(response.data);
        const feed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

        cachedEntities = feed.entity || [];
        lastFetchTime = now;

        console.log(`[GTFS-RT] Successfully decoded feed (${cachedEntities.length} entities)`);

        return cachedEntities;

    } catch (err) {
        console.error('[GTFS-RT] Fetch error:', err);
        return cachedEntities; // fallback to last cached feed
    }
}

function parseTripUpdates(entities) {
    return entities
        .filter(e => e.tripUpdate)
        .map(e => e.tripUpdate)
        .filter(Boolean);
}

function parseVehiclePositions(entities) {
    return entities
        .filter(e => e.vehicle)
        .map(e => e.vehicle)
        .filter(Boolean);
}

module.exports = { fetchGTFSFeed, parseTripUpdates, parseVehiclePositions };