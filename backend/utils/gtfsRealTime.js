const axios = require("axios");
const gtfsRealtimeBindings = require("gtfs-realtime-bindings");

const API_URL = "https://api.opentransportdata.swiss/la/gtfs-rt";
const TOKEN = process.env.API_TOKEN;

async function fetchGTFSData() {
    try {
        const response = await axios.get(API_URL, {
            headers: {
                "Authorization": `Bearer ${TOKEN}`,
                "User-Agent": "RailQuest",
                "Content-Type": "application/octet-stream"
            },
            responseType: "arraybuffer"
        });

        // Decode GTFS Realtime data
        const feed = gtfsRealtimeBindings.FeedMessage.decode(new Uint8Array(response.data));
        return feed.entity; // Return list of realtime updates
    } catch (error) {
        console.error("Error fetching GTFS Realtime data:", error);
        return [];
    }
}

module.exports = fetchGTFSData;