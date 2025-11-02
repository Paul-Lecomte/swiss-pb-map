import fs from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import proj4 from 'proj4';

dotenv.config();

const LV95 =
    '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

console.log('🚀 Starting journey fetch and conversion...');

// ------------------ Fetch train IDs ------------------
async function fetchTrainIds() {
    console.log('📡 Fetching train IDs...');
    const url = `https://api.geops.io/tracker-http/v1/trajectories/sbb/?key=${process.env.GEOPS_API_KEY}`;

    try {
        const response = await axios.get(url);
        const features = response.data.features || [];

        const trainIds = features
            .map(f => f?.properties?.train_id)
            .filter(Boolean);

        const uniqueIds = [...new Set(trainIds)];
        console.log(`✅ Found ${uniqueIds.length} unique train IDs.`);
        return uniqueIds;
    } catch (err) {
        console.error('❌ Failed to fetch train IDs:', err.response?.status || err.message);
        return [];
    }
}

// ------------------ Fetch single journey ------------------
async function fetchJourney(train_id) {
    const url = `https://api.geops.io/tracker-http/v1/journeys/${train_id}/?key=${process.env.GEOPS_API_KEY}`;
    try {
        console.log(`🚉 Fetching journey for train_id: ${train_id}`);
        const response = await axios.get(url);
        const journey = response.data;

        // Convert LV95 → WGS84 coordinates
        journey.features.forEach(feature => {
            if (feature.geometry?.geometries) {
                feature.geometry.geometries.forEach(geom => {
                    if (Array.isArray(geom.coordinates)) {
                        geom.coordinates = geom.coordinates.map(coord =>
                            proj4(LV95, WGS84, coord)
                        );
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

// ------------------ Save journeys ------------------
async function main() {
    console.time('⏱️ Total duration');

    const trainIds = await fetchTrainIds();
    const results = [];
    const savedLineNames = new Set(); // Track unique line_name

    for (const [index, train_id] of trainIds.entries()) {
        console.log(`➡️ [${index + 1}/${trainIds.length}] Processing train_id: ${train_id}`);
        const journeyData = await fetchJourney(train_id);
        if (journeyData) {
            const lineName = journeyData.features?.[0]?.properties?.line_name;
            if (!lineName) continue;

            // Normalize line_name
            const normalizedLine = lineName.toUpperCase().replace(/\s+/g, '').replace(/[.-]/g, '');

            if (!savedLineNames.has(normalizedLine)) {
                results.push(journeyData);
                savedLineNames.add(normalizedLine);
            } else {
                console.log(`⚠️ Skipping duplicate line_name: ${lineName}`);
            }
        }
    }

    fs.writeFileSync('journeys.json', JSON.stringify(results, null, 2));
    console.log(`💾 Saved ${results.length} unique journeys to journeys.json`);
    console.timeEnd('⏱️ Total duration');
    console.log('✅ Done!');
}

main();

// ------------------ Geometry Loader ------------------
export const localGeometries = new Map();
export const journeyFile = 'journeys.json';

export function loadLocalJourneyGeometries() {
    try {
        console.log("🔍 Checking for journey file:", journeyFile);

        if (!fs.existsSync(journeyFile)) {
            console.warn("⚠️ Journey file not found:", journeyFile);
            return;
        }

        const raw = fs.readFileSync(journeyFile, "utf8");
        const dataArray = JSON.parse(raw);

        localGeometries.clear();

        for (const data of dataArray) {
            const lineName = data?.features?.[0]?.properties?.line_name;
            if (!lineName) continue;

            const normalizedLine = lineName.toUpperCase().replace(/\s+/g, '').replace(/[.-]/g, '');
            if (localGeometries.has(normalizedLine)) continue; // skip duplicates

            const coords = [];
            for (const f of data.features || []) {
                const geom = f.geometry;
                if (geom?.type === "GeometryCollection") {
                    for (const g of geom.geometries || []) {
                        if (g.type === "LineString" && Array.isArray(g.coordinates)) {
                            coords.push(...g.coordinates);
                        }
                    }
                }
            }

            if (coords.length > 1) localGeometries.set(normalizedLine, coords);
        }

        console.log(`✅ Loaded ${localGeometries.size} local route geometries.`);
    } catch (err) {
        console.error("❌ Failed to load journey.json:", err);
    }
}

// ------------------ Geometry fetcher by line_name ------------------
export function fetchLocalGeometryByLineName(lineName) {
    if (!lineName) return null;
    const normalizedLine = lineName.toUpperCase().replace(/\s+/g, '').replace(/[.-]/g, '');
    const geom = localGeometries.get(normalizedLine);
    if (geom && geom.length > 1) return geom;
    return null;
}