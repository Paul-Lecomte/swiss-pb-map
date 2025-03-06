const fs = require('fs');
const axios = require('axios');
const gtfsRealtimeBindings = require('gtfs-realtime-bindings');

const API_URL = 'https://api.opentransportdata.swiss/la/gtfs-rt';
const TOKEN = process.env.API_TOKEN;

async function fetchGTFSData() {
    try {
        const response = await axios.get(API_URL, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'User-Agent': 'RailQuest',
                'Content-Type': 'application/octet-stream'
            },
            responseType: 'arraybuffer'
        });

        console.log('GTFS Realtime Data Received:', response.data.length, 'bytes');

        // Save raw buffer to a file for debugging
        fs.writeFileSync('gtfs-realtime-data.bin', response.data);

        // Convert response data to a Buffer
        const buffer = Buffer.from(response.data);

        // Decode GTFS Realtime data
        if (gtfsRealtimeBindings.transit_realtime && gtfsRealtimeBindings.transit_realtime.FeedMessage) {
            try {
                const feed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
                console.log("Decoded GTFS Data completed");
                return feed.entity; // Return the actual data you want to use
            } catch (decodeError) {
                console.error("GTFS Decode Error:", decodeError);
                return []; // Return empty array if decoding fails
            }
        } else {
            console.error("FeedMessage is not defined or invalid.");
            return []; // Return empty array if FeedMessage is not defined
        }
    } catch (error) {
        console.error('Error fetching GTFS Realtime data:', error);
        return []; // Return empty array if fetching fails
    }
}

module.exports = fetchGTFSData;