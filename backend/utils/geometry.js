import fs from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import proj4 from 'proj4';

dotenv.config();

const LV95 =
    '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

console.log('🚀 Starting journey fetch and conversion...');

// Step 1: Fetch all train_ids from features
async function fetchTrainIds() {
    console.log('📡 Fetching train IDs...');
    const url = `https://api.geops.io/tracker-http/v1/trajectories/sbb/?key=${process.env.GEOPS_API_KEY}`;
    const response = await axios.get(url);

    const features = response.data.features || [];
    const trainIds = features
        .map(f => f?.properties?.train_id)
        .filter(Boolean); // remove undefined/null

    const uniqueIds = [...new Set(trainIds)];
    console.log(`✅ Found ${uniqueIds.length} unique train IDs.`);
    return uniqueIds;
}

// Step 2: Fetch each journey and convert coordinates
async function fetchJourney(train_id) {
    const url = `https://api.geops.io/tracker-http/v1/journeys/${train_id}/?key=${process.env.GEOPS_API_KEY}`;
    try {
        console.log(`🚉 Fetching journey for train_id: ${train_id}`);
        const response = await axios.get(url);
        const journey = response.data;

        // Convert LV95 -> WGS84 coordinates
        journey.features.forEach(feature => {
            if (feature.geometry?.geometries) {
                feature.geometry.geometries.forEach(geom => {
                    if (Array.isArray(geom.coordinates)) {
                        geom.coordinates = geom.coordinates.map(coord => proj4(LV95, WGS84, coord));
                    }
                });
            }
        });

        return journey;
    } catch (err) {
        console.error(`⚠️ Error fetching train_id ${train_id}:`, err.response?.status || err.message);
        return null;
    }
}

// Step 3: Main execution
async function main() {
    const trainIds = await fetchTrainIds();
    const results = [];

    for (const train_id of trainIds) {
        const journeyData = await fetchJourney(train_id);
        if (journeyData) {
            results.push(journeyData);
        }
    }

    fs.writeFileSync('journeys.json', JSON.stringify(results, null, 2));
    console.log('💾 Saved all journeys to journeys.json');
}

main();