/**
 * Commands to update GTFS collections:
 *
 * 1. Update all GTFS collections (agency, calendar, stops, etc.) + ProcessedStops:
 *    node backend/utils/gtfsDataUpdater.js
 *
 * 2. Update only stops:
 *    node backend/utils/gtfsDataUpdater.js --stops
 *
 * 3. Update ProcessedStops (reload required collections and build ProcessedStops):
 *    node backend/utils/gtfsDataUpdater.js --processedstops
 *
 * 4. Update ProcessedRoute (optimized pipeline, does not touch base collections):
 *    node backend/utils/gtfsDataUpdater.js --processedroutes
 *
 * 5. Update only base GTFS collections (skip ProcessedStops and ProcessedRoute):
 *    node backend/utils/gtfsDataUpdater.js --base
 *
 * 6. update the ProcessedStopTimes collection:
 *   node backend/utils/gtfsDataUpdater.js --processedstoptimes
 *
 * Run these commands in the terminal at the project root.
 */

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const unzipper = require('unzipper');
const { promisify } = require('util');
const { parse } = require('csv-parse');
const stream = require('stream');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const connectDB = require('../config/dbConnection');
const { buildRouteGeometry } = require('./routingHelper');
const csv = require('csv-parser');

// Import models
const Agency = require('../model/agencyModel');
const Calendar = require('../model/calendarModel');
const CalendarDate = require('../model/calendarDatesModel');
const FeedInfo = require('../model/feedInfoModel');
const Route = require('../model/routesModel');
const StopTime = require('../model/stopTimesModel');
const Stop = require('../model/stopsModel');
const Transfer = require('../model/transfersModel');
const Trip = require('../model/tripsModel');
const ProcessedStop = require('../model/processedStopsModel');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');

const pipeline = promisify(stream.pipeline);
const DATA_DIR = path.join(__dirname, '../backend/data/gtfs_data');
const ZIP_FILE_PATH = path.join(DATA_DIR, 'gtfs.zip');
const GTFS_BASE_URL = 'https://data.opentransportdata.swiss/en/dataset/timetable-2025-gtfs2020';
// Optional static GTFS directory (if present, used for processed routes instead of download)
const STATIC_GTFS_DIR = path.join(__dirname, '../data/gtfs');

function copyDirectoryRecursiveSync(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryRecursiveSync(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Ensure the data directory exists
if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DATA_DIR, { recursive: true });

// -------------------------
// Helpers
// -------------------------

async function getLatestGTFSLink() {
    console.log('Fetching latest GTFS data link...');
    try {
        const response = await axios.get(GTFS_BASE_URL);
        const $ = cheerio.load(response.data);
        const latestLink = $('a[href*="download/gtfs_fp2025_"]').attr('href');
        if (!latestLink) throw new Error('No GTFS download link found');
        const fullUrl = new URL(latestLink, GTFS_BASE_URL).href;
        console.log('Latest GTFS data URL:', fullUrl);
        return fullUrl;
    } catch (error) {
        console.error('Error fetching GTFS link:', error);
        throw error;
    }
}

async function downloadGTFS() {
    console.log('Downloading GTFS data...');
    const latestGTFSLink = await getLatestGTFSLink();
    const response = await axios({ url: latestGTFSLink, method: 'GET', responseType: 'stream', timeout: 300000 });
    await pipeline(response.data, fs.createWriteStream(ZIP_FILE_PATH));
    console.log('Download complete.');
}

async function extractGTFS() {
    console.log('Extracting GTFS data...');
    const directory = await unzipper.Open.file(ZIP_FILE_PATH);
    await Promise.all(directory.files.map(file => {
        return new Promise((resolve, reject) => {
            // ensure directories exist
            const outPath = path.join(DATA_DIR, file.path);
            const dir = path.dirname(outPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            file.stream()
                .pipe(fs.createWriteStream(outPath))
                .on('finish', resolve)
                .on('error', reject);
        });
    }));
    console.log('GTFS data extracted successfully');
}

async function getRouteColor(routeShortName) {
    if (!routeShortName) return '#777';
    const name = routeShortName.toUpperCase().trim();

    // Mainline & Regional Trains (SBB & Regionalbahnen)
    if (/^ICN\b/.test(name)) return '#C9202C'; // InterCity Tilting (ICN)
    if (/^IC\b/.test(name))  return '#E63946'; // InterCity
    if (/^IR\b/.test(name))  return '#F3722C'; // InterRegio
    if (/^RE\b/.test(name))  return '#F4A261'; // RegioExpress
    if (/^R\d|\bREGIO\b|^R\b/.test(name)) return '#E9C46A'; // Regio
    if (/^S\d|\bS-?BAHN\b|\bS\b/.test(name)) return '#0078D7'; // S-Bahn / commuter rail
    if (/^SN/.test(name)) return '#4361EE'; // Night S-Bahn

    // International Trains
    if (/^EC\b/.test(name))   return '#9B2226';  // EuroCity
    if (/^EN\b/.test(name))   return '#BB3E03';  // EuroNight
    if (/^ICE\b/.test(name))  return '#457B9D'; // ICE (Germany)
    if (/^(TGV|LYR|LYRIA)\b/.test(name)) return '#C1121F'; // TGV / Lyria
    if (/^RJX?\b/.test(name)) return '#E76F51'; // Railjet / Railjet Express
    if (/^NJ\b/.test(name))   return '#6A040F';  // NightJet
    if (/^PE\b/.test(name))   return '#4CC9F0';  // Panorama Express
    if (/^IN\b/.test(name))   return '#7209B7';  // InterCity Night
    if (/^RB\b/.test(name))   return '#E9C46A';  // Regionalbahn

    // Urban Public Transport
    if (/^T\d|\bTRAM\b/.test(name)) return '#2A9D8F'; // Tram / streetcar
    if (/^M\d|\bMETRO\b/.test(name)) return '#00B4D8'; // Metro
    if (/^U\d|\bU-?BAHN\b/.test(name)) return '#00B4D8'; // Metro / underground
    if (/^G\d|\bTROLLEY\b|\bTROLLEYBUS\b/.test(name)) return '#118AB2'; // Trolleybus
    if (/^B\d|\bBUS\b/.test(name)) return '#264653'; // Bus
    if (/^E\d|EXP|EXPRESS\b/.test(name)) return '#90BE6D'; // Express bus
    if (/^P\d|\bPOSTAUTO\b|\bPOSTBUS\b/.test(name)) return '#FFD100'; // PostBus (yellow)
    if (/^NB|\bNIGHT\b/.test(name)) return '#6D597A'; // Night Bus
    if (/^CAR|CAX/.test(name)) return '#8D99AE'; // Long-distance / intercity coach

    //  Boats & Ferries
    if (/^MS\d|\bMS\b|\bSHIP\b|\bBOAT\b|\bFERRY\b|\bSGV\b|\bBAT\b/.test(name)) return '#3A86FF';

    // Mountain Transports (Cable cars, funiculars, lifts)
    if (/^L|F/.test(name)) return '#8338EC'; // Lift / funicular
    if (/^CC|SL/.test(name)) return '#9D4EDD'; // Cable car / ski lift
    if (/^ASC/.test(name)) return '#7209B7'; // Elevator (ascenseur)
    if (/\b(FUNI|FUNIC|SEIL|BAHN|ZAHNRAD|GGB|MGB|RHB|STATION)\b/.test(name)) return '#8338EC'; // mountain railways

    //  Tourist / Scenic / Misc
    if (/^PE\b|PANORAMA|GLACIER|BERNINA|GOLDENPASS|GEX|GOTTHARD|GPX/.test(name)) return '#B5703A'; // Panorama / tourist
    if (/^D/.test(name)) return '#FFBA08';    // Dotto / tourist train
    if (/^Z/.test(name)) return '#F8961E';    // Zahnradbahn (rack railway)

    // Fallback heuristics
    if (/^\d+$/.test(name)) return '#264653';          // numeric-only -> likely bus/regio
    if (/^[A-Z]{1,3}\d*$/.test(name)) return '#0078D7'; // short alpha -> S / regional default

    // Default unknown
    return '#777';
}

// -------------------------
// Shapes loader (for GTFS geometries)
// -------------------------

async function loadShapesMap() {
    const shapesFile = path.join(__dirname, '../data/gtfs/shapes.txt');

    if (!fs.existsSync(shapesFile)) {
        console.log("the path is:", shapesFile);
        console.warn('⚠️ shapes.txt not found in backend/data/gtfs, skipping shape-based geometries.');
        return new Map();
    }

    console.log('Loading shapes.txt from backend/data/gtfs...');
    const shapesMap = new Map();

    return new Promise((resolve, reject) => {
        fs.createReadStream(shapesFile)
            .pipe(csv())
            .on('data', row => {
                let id = row.shape_id?.trim();
                if (!id) return;
                id = id.replace(/[\r\n]/g, '');
                const lat = parseFloat(row.shape_pt_lat);
                const lon = parseFloat(row.shape_pt_lon);
                const seq = parseInt(row.shape_pt_sequence, 10);
                if (isNaN(lat) || isNaN(lon)) return;
                if (!shapesMap.has(id)) shapesMap.set(id, []);
                shapesMap.get(id).push({ seq, coord: [lon, lat] });
            })
            .on('end', () => {
                for (const [id, points] of shapesMap.entries()) {
                    points.sort((a, b) => a.seq - b.seq);
                    shapesMap.set(id, points.map(p => p.coord));
                }
                console.log(`✅ Loaded ${shapesMap.size} shapes from shapes.txt`);
                resolve(shapesMap);
            })
            .on('error', reject);
    });
}



// -------------------------
// Generic CSV parse (DB mode and small-return mode)
// -------------------------

async function parseCSV(fileName, model, name, { saveToDB = true } = {}) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        console.log(`File ${fileName} not found, skipping...`);
        return saveToDB ? 0 : [];
    }

    console.log(`Processing ${fileName} (${saveToDB ? 'saving to DB' : 'returning in memory'})...`);

    return new Promise((resolve, reject) => {
        const results = [];
        const parser = parse({
            columns: (header) => header.map(col => col.trim().toLowerCase()),
            relax_column_count: true,
            skip_empty_lines: true,
        });

        const rs = fs.createReadStream(filePath);
        rs.pipe(parser);

        parser.on('data', (row) => {
            results.push(row);
        });

        parser.on('end', async () => {
            try {
                if (saveToDB) {
                    // replace collection
                    await model.deleteMany({});
                    if (results.length) {
                        // insert in batches to avoid single huge insert
                        const batchSize = 100000;
                        for (let i = 0; i < results.length; i += batchSize) {
                            const chunk = results.slice(i, i + batchSize);
                            await model.insertMany(chunk, { ordered: false });
                            console.log(`Inserted chunk ${i}-${i + chunk.length} for ${name}`);
                        }
                    }
                    console.log(`${name} collection updated: ${results.length} records`);
                    resolve(results.length);
                } else {
                    // return parsed rows (use carefully — for large files you should not call this)
                    resolve(results);
                }
            } catch (err) {
                console.error(`Error processing ${name}:`, err.message);
                reject(err);
            }
        });

        parser.on('error', (err) => {
            console.error(`Parser error on ${fileName}:`, err);
            reject(err);
        });
    });
}


// -------------------------
// ProcessedStopTimes helpers
// -------------------------

async function populateProcessedStopTimes() {
    const filePath = path.join(DATA_DIR, 'stop_times.txt');

    console.log('Processing trips.txt (returning in memory)...');
    const trips = await parseCSV('trips.txt', null, 'Trip', { saveToDB: false });
    console.log(`✅ Loaded ${trips.length} trips from trips.txt`);
    console.log('Sample trip:', trips[0]);

    const tripMap = new Map(trips.map(t => [t.trip_id, t.route_id]));

    await ProcessedStopTimes.deleteMany({});
    console.log('Cleared ProcessedStopTimes collection.');

    // 🟢 Wrap CSV parsing in a Promise so we can await it
    await new Promise((resolve, reject) => {
        const map = new Map();

        fs.createReadStream(filePath)
            // ✅ Force lowercase headers for consistency
            .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
            .on('data', (row) => {
                const tripId = row.trip_id;
                const routeId = tripMap.get(tripId);

                // Optional debug: log unexpected header cases
                if (!tripId || !routeId) {
                    // console.log('⚠️ Skipping row, missing keys:', Object.keys(row));
                    return;
                }

                if (!map.has(tripId)) {
                    map.set(tripId, {
                        trip_id: tripId,
                        route_id: routeId,
                        stop_times: [],
                    });
                }

                map.get(tripId).stop_times.push({
                    stop_id: row.stop_id,
                    arrival_time: row.arrival_time,
                    departure_time: row.departure_time,
                    stop_sequence: parseInt(row.stop_sequence),
                });
            })
            .on('end', async () => {
                try {
                    console.log(`Parsed ${map.size} trips. Sorting and inserting...`);

                    const docs = Array.from(map.values()).map(t => ({
                        ...t,
                        stop_times: t.stop_times.sort((a, b) => a.stop_sequence - b.stop_sequence),
                    }));

                    const batchSize = 5000;
                    for (let i = 0; i < docs.length; i += batchSize) {
                        await ProcessedStopTimes.insertMany(
                            docs.slice(i, i + batchSize),
                            { ordered: false }
                        );
                        console.log(`Inserted ${Math.min(i + batchSize, docs.length)} / ${docs.length}`);
                    }

                    console.log(`✅ Done. Inserted ${docs.length} processed stop time documents.`);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            })
            .on('error', reject);
    });
}

// -------------------------
// Memory-efficient helpers for stop_times (streaming passes)
// -------------------------

async function countStopTimesPerTrip(fileName) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return new Map();

    console.log('Counting stop_times per trip (streaming pass 1)...');
    return new Promise((resolve, reject) => {
        const counts = new Map();
        const parser = parse({
            columns: (header) => header.map(col => col.trim().toLowerCase()),
            relax_column_count: true,
            skip_empty_lines: true,
        });

        const rs = fs.createReadStream(filePath);
        rs.pipe(parser);

        parser.on('data', (row) => {
            const tripId = row.trip_id;
            if (!tripId) return;
            counts.set(tripId, (counts.get(tripId) || 0) + 1);
        });

        parser.on('end', () => {
            console.log(`stop_times counts gathered: ${counts.size} trips seen`);
            resolve(counts);
        });

        parser.on('error', (err) => {
            console.error('Error counting stop_times:', err);
            reject(err);
        });
    });
}

/**
 * Second pass: collect stop_times only for the requested tripIds.
 * Returns a Map<trip_id, Array<stop_time_row>>.
 */
async function collectStopTimesForTripIds(fileName, tripIdSet) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return new Map();

    console.log(`Collecting stop_times for ${tripIdSet.size} selected trips (streaming pass 2)...`);
    return new Promise((resolve, reject) => {
        const map = new Map();
        for (const id of tripIdSet) map.set(id, []); // precreate arrays to preserve order

        const parser = parse({
            columns: (header) => header.map(col => col.trim().toLowerCase()),
            relax_column_count: true,
            skip_empty_lines: true,
        });

        const rs = fs.createReadStream(filePath);
        rs.pipe(parser);

        parser.on('data', (row) => {
            const tripId = row.trip_id;
            if (!tripId) return;
            if (map.has(tripId)) {
                // push minimal necessary fields; keep stop_sequence as integer string for sorting
                map.get(tripId).push({
                    trip_id: row.trip_id,
                    stop_id: row.stop_id,
                    stop_sequence: row.stop_sequence,
                    arrival_time: row.arrival_time,
                    departure_time: row.departure_time
                });
            }
        });

        parser.on('end', () => {
            // Some trips may have no entries; fine
            console.log('Finished collecting selected stop_times.');
            resolve(map);
        });

        parser.on('error', (err) => {
            console.error('Error collecting stop_times:', err);
            reject(err);
        });
    });
}

/**
 * Stream stops.txt into a Map<stop_id, stopRow>
 */
async function buildStopMap(fileName) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return new Map();

    console.log('Building stop map (streaming)...');
    return new Promise((resolve, reject) => {
        const map = new Map();
        const parser = parse({
            columns: (header) => header.map(col => col.trim().toLowerCase()),
            relax_column_count: true,
            skip_empty_lines: true,
        });

        const rs = fs.createReadStream(filePath);
        rs.pipe(parser);

        parser.on('data', (row) => {
            if (row.stop_id) {
                map.set(row.stop_id, {
                    stop_id: row.stop_id,
                    stop_name: row.stop_name,
                    stop_lat: row.stop_lat,
                    stop_lon: row.stop_lon,
                    location_type: row.location_type,
                    parent_station: row.parent_station
                });
            }
        });

        parser.on('end', () => {
            console.log(`Stop map built: ${map.size} stops`);
            resolve(map);
        });

        parser.on('error', (err) => {
            console.error('Error building stop map:', err);
            reject(err);
        });
    });
}

// -------------------------
// ProcessedStops (unchanged DB-based - uses DB collections)
// -------------------------

async function populateProcessedStops() {
    console.log('Starting high-performance population of ProcessedStop...');
    await ProcessedStop.deleteMany({});
    console.log('Cleared ProcessedStop collection.');

    const [allTrips, allRoutes] = await Promise.all([
        Trip.find({}),
        Route.find({})
    ]);
    console.log(`Loaded ${allTrips.length} trips and ${allRoutes.length} routes into memory.`);

    const tripMap = new Map(allTrips.map(trip => [trip.trip_id, trip]));
    const routeMap = new Map(allRoutes.map(route => [route.route_id, route]));

    const stopCursor = Stop.find({}).cursor();
    const batchSize = 1000;
    let stopsBatch = [];
    let processedCount = 0;
    let batchNumber = 1;

    for (let stop = await stopCursor.next(); stop != null; stop = await stopCursor.next()) {
        stopsBatch.push(stop);

        if (stopsBatch.length === batchSize) {
            await processStopBatch(stopsBatch, tripMap, routeMap, batchNumber);
            processedCount += stopsBatch.length;
            stopsBatch = [];
            batchNumber++;
        }
    }

    if (stopsBatch.length > 0) {
        await processStopBatch(stopsBatch, tripMap, routeMap, batchNumber);
        processedCount += stopsBatch.length;
    }

    console.log(`Finished. Total ProcessedStop records inserted: ${processedCount}`);
}

async function processStopBatch(stopsBatch, tripMap, routeMap, batchNumber) {
    const stopIds = stopsBatch.map(s => s.stop_id);
    const stopTimes = await StopTime.find({ stop_id: { $in: stopIds } });

    const stopTimeMap = new Map();
    for (const st of stopTimes) {
        if (!stopTimeMap.has(st.stop_id)) {
            stopTimeMap.set(st.stop_id, []);
        }
        stopTimeMap.get(st.stop_id).push(st);
    }

    const processedStops = stopsBatch.map(stop => {
        const stopTimes = stopTimeMap.get(stop.stop_id) || [];
        const routeSet = new Map();

        for (const st of stopTimes) {
            const trip = tripMap.get(st.trip_id);
            if (!trip) continue;

            const route = routeMap.get(trip.route_id);
            if (!route) continue;

            routeSet.set(route.route_id, {
                route_id: route.route_id,
                route_short_name: route.route_short_name,
                route_type: route.route_type,
                route_desc: route.route_desc,
                route_long_name: route.route_long_name,
                trip_headsign: trip.trip_headsign,
                trip_id: trip.trip_id,
                trip_short_name: trip.trip_short_name,
            });
        }

        return {
            stop_id: stop.stop_id,
            stop_name: stop.stop_name,
            stop_lat: stop.stop_lat,
            stop_lon: stop.stop_lon,
            location_type: stop.location_type,
            parent_station: stop.parent_station,
            routes: [...routeSet.values()],
        };
    });

    console.log(`Inserting batch ${batchNumber} with ${processedStops.length} stops...`);
    await ProcessedStop.insertMany(processedStops, { ordered: false });
}


// -------------------------
// Load mapping of trip_id → shape_id from trips.txt
// Normalizes shape_id (trim, remove CR/LF, consistent casing)
// -------------------------
async function loadTripShapeMap() {
    const filePath = path.join(DATA_DIR, 'trips.txt');
    if (!fs.existsSync(filePath)) return new Map();

    console.log('Building trip → shape_id map (streaming trips.txt)...');
    return new Promise((resolve, reject) => {
        const map = new Map();
        const parser = parse({
            columns: header => header.map(col => col.trim().toLowerCase()),
            relax_column_count: true,
            skip_empty_lines: true,
        });

        const rs = fs.createReadStream(filePath);
        rs.pipe(parser);

        parser.on('data', row => {
            const tripId = row.trip_id?.trim();
            let shapeId = row.shape_id?.trim();
            if (shapeId) shapeId = shapeId.replace(/[\r\n]/g, '');
            if (tripId && shapeId) map.set(tripId, shapeId);
        });

        parser.on('end', () => {
            console.log(`✅ Trip→Shape map built for ${map.size} trips`);
            resolve(map);
        });

        parser.on('error', reject);
    });
}


// -------------------------
// File-based ProcessedRoutes (memory efficient)
// -------------------------

async function populateProcessedRoutesFromFiles() {
    console.log('Starting file-based population of ProcessedRoute (memory-efficient)...');
    await ProcessedRoute.deleteMany({});
    console.log('Cleared ProcessedRoute collection.');

    const routes = await parseCSV('routes.txt', Route, 'Route', { saveToDB: false });
    const counts = await countStopTimesPerTrip('stop_times.txt');
    const mainTripForRoute = await findMainTripsForRoutes('trips.txt', counts);
    const mainTripIds = new Set(mainTripForRoute.values());

    // Load shapes.txt and trip→shape_id mapping
    const [shapesMap, tripShapeMap] = await Promise.all([
        loadShapesMap(),
        loadTripShapeMap()
    ]);

    const stopTimesMap = await collectStopTimesForTripIds('stop_times.txt', mainTripIds);
    const stopMap = await buildStopMap('stops.txt');

    const batchSize = 1;
    let batch = [];
    let insertedCount = 0;

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        if (routeIndex % 10 === 0 || routeIndex === 0) {
            console.log(`Building route ${routeIndex + 1}/${routes.length} (route_id=${route.route_id})`);
        }

        const mainTripId = mainTripForRoute.get(route.route_id);
        let orderedStops = [];

        // Collect ordered stops for mainTripId
        if (mainTripId) {
            const stList = stopTimesMap.get(mainTripId) || [];
            stList.sort((a, b) => parseInt(a.stop_sequence || '0') - parseInt(b.stop_sequence || '0'));
            orderedStops = stList
                .map(st => {
                    const stop = stopMap.get(st.stop_id);
                    if (!stop) return null;
                    return {
                        stop_id: stop.stop_id,
                        stop_name: stop.stop_name,
                        stop_lat: parseFloat(stop.stop_lat),
                        stop_lon: parseFloat(stop.stop_lon),
                        stop_sequence: parseInt(st.stop_sequence || '0'),
                    };
                })
                .filter(Boolean);
        }

        const lats = orderedStops.map(s => s.stop_lat);
        const lons = orderedStops.map(s => s.stop_lon);
        const bounds = (lats.length && lons.length)
            ? {
                min_lat: Math.min(...lats),
                max_lat: Math.max(...lats),
                min_lon: Math.min(...lons),
                max_lon: Math.max(...lons)
            }
            : null;

        let geometryCoords = [];

        if (orderedStops.length >= 2) {
            try {
                // Fetch the shape_id for the main trip and clean it
                let shapeId = mainTripId ? tripShapeMap.get(mainTripId) : null;
                if (shapeId) shapeId = shapeId.trim().replace(/[\r\n]/g, '');

                // Use shapes.txt geometry if available
                if (shapeId && shapesMap.has(shapeId)) {
                    geometryCoords = shapesMap.get(shapeId);
                    console.log(`✅ Using shapes.txt geometry for route ${route.route_id} (shape_id=${shapeId})`);
                } else {
                    // Fallback: build geometry from stops (only if shapes missing)
                    console.log(`⚙️ Falling back to SwissTNE/OSRM for route ${route.route_id}`);
                    geometryCoords = await buildRouteGeometry(
                        orderedStops,
                        route.route_type,
                        2,
                        mainTripId || route.route_id
                    );
                }
            } catch (err) {
                console.error(`❌ Failed to build geometry for route ${route.route_id}:`, err.message);
            }
        }

        const processedRoute = {
            route_id: route.route_id,
            trip_id: mainTripId,
            agency_id: route.agency_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_type: route.route_type,
            route_desc: route.route_desc,
            route_color: route.route_color || await getRouteColor(route.route_short_name),
            route_text_color: route.route_text_color,
            stops: orderedStops,
            bounds,
            straight_line: geometryCoords.length < 1,
            geometry: {
                type: "LineString",
                coordinates: geometryCoords.length
                    ? geometryCoords
                    : orderedStops.map(s => [s.stop_lon, s.stop_lat])
            }
        };

        batch.push(processedRoute);

        if (batch.length === batchSize) {
            console.log(`Inserting batch of ${batch.length} processed routes`);
            await ProcessedRoute.insertMany(batch, { ordered: false });
            insertedCount += batch.length;
            batch = [];
        }
    }

    if (batch.length > 0) {
        console.log(`Inserting final batch of ${batch.length} processed routes`);
        await ProcessedRoute.insertMany(batch, { ordered: false });
        insertedCount += batch.length;
    }

    console.log(`✅ ProcessedRoute population completed. Total inserted: ${insertedCount}`);
}

// -------------------------
// Full update function (DB-mode)
// -------------------------

async function updateGTFSData() {
    try {
        await connectDB();
        await downloadGTFS();
        await extractGTFS();

        const filesToParse = {
            'agency.txt': { model: Agency, name: 'Agency' },
            'calendar.txt': { model: Calendar, name: 'Calendar' },
            'calendar_dates.txt': { model: CalendarDate, name: 'Calendar Date' },
            'feed_info.txt': { model: FeedInfo, name: 'Feed Info' },
            'routes.txt': { model: Route, name: 'Route' },
            'stop_times.txt': { model: StopTime, name: 'Stop Time' },
            'stops.txt': { model: Stop, name: 'Stop' },
            'transfers.txt': { model: Transfer, name: 'Transfer' },
            'trips.txt': { model: Trip, name: 'Trip' }
        };

        for (const { model, name } of Object.values(filesToParse)) {
            try {
                await model.deleteMany({});
                console.log(`Cleared existing data in ${name} collection.`);
            } catch (error) {
                console.error(`Error clearing ${name} collection:`, error);
            }
        }

        for (const [file, { model, name }] of Object.entries(filesToParse)) {
            try {
                await parseCSV(file, model, name); // default saveToDB = true
            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        }

        await populateProcessedStops();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });

        console.log('GTFS data update completed.');
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
}

// -------------------------
// CLI Main
// -------------------------

const args = process.argv.slice(2);

async function main() {
    await connectDB();

    if (args.includes('--base')) {
        console.log('Updating only base GTFS collections (excluding ProcessedStops/ProcessedRoute)...');
        await downloadGTFS();
        await extractGTFS();

        const baseFiles = [
            { file: 'agency.txt', model: Agency, name: 'Agency' },
            { file: 'calendar.txt', model: Calendar, name: 'Calendar' },
            { file: 'calendar_dates.txt', model: CalendarDate, name: 'Calendar Date' },
            { file: 'feed_info.txt', model: FeedInfo, name: 'Feed Info' },
            { file: 'routes.txt', model: Route, name: 'Route' },
            { file: 'stop_times.txt', model: StopTime, name: 'Stop Time' },
            { file: 'stops.txt', model: Stop, name: 'Stop' },
            { file: 'transfers.txt', model: Transfer, name: 'Transfer' },
            { file: 'trips.txt', model: Trip, name: 'Trip' }
        ];

        for (const { file, model, name } of baseFiles) {
            try {
                await parseCSV(file, model, name);
            } catch (err) {
                console.error(`Error updating ${name}:`, err.message);
            }
        }

        console.log('✅ Base GTFS collections updated (ProcessedStops/ProcessedRoute skipped)');
    }

    if (args.includes('--processedstoptimes')) {
        await downloadGTFS();
        await extractGTFS();
        await populateProcessedStopTimes();
    }

    if (args.includes('--stops')) {
        await downloadGTFS();
        await extractGTFS();
        await parseCSV('stops.txt', Stop, 'Stop');
    }

    if (args.includes('--processedstops')) {
        // current behavior: reload underlying collections then build ProcessedStops (DB-based)
        await downloadGTFS();
        await extractGTFS();

        await parseCSV('stops.txt', Stop, 'Stop');
        await parseCSV('stop_times.txt', StopTime, 'Stop Time');
        await parseCSV('routes.txt', Route, 'Route');
        await parseCSV('trips.txt', Trip, 'Trip');

        await populateProcessedStops();
    }

    if (args.includes('--processedroutes')) {
        // file-based, memory-efficient pipeline that does NOT write stops/trips/stop_times/routes to DB
        // Prefer static GTFS folder if present to avoid network download
        if (fs.existsSync(STATIC_GTFS_DIR)) {
            console.log('Using static GTFS data from', STATIC_GTFS_DIR);
            // ensure DATA_DIR is clean
            if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
            fs.mkdirSync(DATA_DIR, { recursive: true });
            copyDirectoryRecursiveSync(STATIC_GTFS_DIR, DATA_DIR);
        } else {
            // fallback to downloading latest GTFS
            await downloadGTFS();
            await extractGTFS();
        }

        await populateProcessedRoutesFromFiles();
    }

    if (args.length === 0) {
        await updateGTFSData();
    }

    mongoose.connection.close();
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    mongoose.connection.close();
    process.exit(1);
});

// Streaming helper: determine main trip (max stop_times count) per route without loading all trips into memory
async function findMainTripsForRoutes(fileName, countsMap) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return new Map();

    console.log('Selecting main trip per route (streaming trips.txt)...');
    return new Promise((resolve, reject) => {
        const bestByRoute = new Map(); // route_id -> {trip_id, count}

        const parser = parse({
            columns: (header) => header.map(col => col.trim().toLowerCase()),
            relax_column_count: true,
            skip_empty_lines: true,
        });

        const rs = fs.createReadStream(filePath);
        rs.pipe(parser);

        parser.on('data', (row) => {
            const routeId = row.route_id;
            const tripId = row.trip_id;
            if (!routeId || !tripId) return;
            const c = countsMap.get(tripId) || 0;
            const cur = bestByRoute.get(routeId);
            if (!cur || c > cur.count) {
                bestByRoute.set(routeId, { trip_id: tripId, count: c });
            }
        });

        parser.on('end', () => {
            const result = new Map();
            for (const [routeId, info] of bestByRoute) {
                if (info && info.trip_id) result.set(routeId, info.trip_id);
            }
            console.log(`Main trips selected for ${result.size} routes`);
            resolve(result);
        });

        parser.on('error', (err) => {
            console.error('Error streaming trips.txt:', err);
            reject(err);
        });
    });
}