const axios = require('axios');

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
            responseType: 'arraybuffer'  // Binary response
        });

        console.log('GTFS Realtime Data Received:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error fetching GTFS data:', error);
    }
}

fetchGTFSData();