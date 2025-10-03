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
const { buildRouteGeometry, mapRouteTypeToProfile } = require('./routingHelper');

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

const pipeline = promisify(stream.pipeline);
const DATA_DIR = path.join(__dirname, 'gtfs_data');
const ZIP_FILE_PATH = path.join(DATA_DIR, 'gtfs.zip');
const GTFS_BASE_URL = 'https://data.opentransportdata.swiss/en/dataset/timetable-2025-gtfs2020';

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
// Memory-efficient helpers for stop_times (streaming passes)
// -------------------------

/**
 * First pass: count stop_time rows per trip_id.
 * Returns a Map<trip_id, count>
 */
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
// File-based ProcessedRoutes (memory efficient)
// -------------------------

async function populateProcessedRoutesFromFiles() {
    console.log('Starting file-based population of ProcessedRoute (memory-efficient)...');
    await ProcessedRoute.deleteMany({});
    console.log('Cleared ProcessedRoute collection.');

    const routes = await parseCSV('routes.txt', Route, 'Route', { saveToDB: false });
    const trips = await parseCSV('trips.txt', Trip, 'Trip', { saveToDB: false });

    const tripGroups = new Map();
    const tripById = new Map();
    for (const t of trips) {
        if (!tripGroups.has(t.route_id)) tripGroups.set(t.route_id, []);
        tripGroups.get(t.route_id).push(t);
        tripById.set(t.trip_id, t);
    }

    const counts = await countStopTimesPerTrip('stop_times.txt');

    const mainTripForRoute = new Map();
    const mainTripIds = new Set();
    for (const route of routes) {
        const tripsForRoute = tripGroups.get(route.route_id) || [];
        let bestTripId = null;
        let bestCount = -1;
        for (const trip of tripsForRoute) {
            const c = counts.get(trip.trip_id) || 0;
            if (c > bestCount) {
                bestCount = c;
                bestTripId = trip.trip_id;
            }
        }
        if (bestTripId) {
            mainTripForRoute.set(route.route_id, bestTripId);
            mainTripIds.add(bestTripId);
        }
    }

    const stopTimesMap = await collectStopTimesForTripIds('stop_times.txt', mainTripIds);
    const stopMap = await buildStopMap('stops.txt');

    const batchSize = 50;
    let batch = [];
    let insertedCount = 0;
    let routeIndex = 0;

    for (const route of routes) {
        routeIndex++;
        if (routeIndex % 10 === 0 || routeIndex === 1) {
            console.log(`Building route ${routeIndex}/${routes.length} (route_id=${route.route_id})`);
        }

        const mainTripId = mainTripForRoute.get(route.route_id);
        let orderedStops = [];

        if (mainTripId) {
            const stList = stopTimesMap.get(mainTripId) || [];
            stList.sort((a, b) => parseInt(a.stop_sequence || '0') - parseInt(b.stop_sequence || '0'));
            orderedStops = stList.map(st => {
                const stop = stopMap.get(st.stop_id);
                if (!stop) return null;
                return {
                    stop_id: stop.stop_id,
                    stop_name: stop.stop_name,
                    stop_lat: parseFloat(stop.stop_lat),
                    stop_lon: parseFloat(stop.stop_lon),
                    stop_sequence: parseInt(st.stop_sequence || '0')
                };
            }).filter(Boolean);
        }

        const lats = orderedStops.map(s => s.stop_lat);
        const lons = orderedStops.map(s => s.stop_lon);
        const bounds = (lats.length && lons.length) ? {
            min_lat: Math.min(...lats),
            max_lat: Math.max(...lats),
            min_lon: Math.min(...lons),
            max_lon: Math.max(...lons)
        } : null;

        let geometryCoords = [];
        if (orderedStops.length >= 2) {
            // ✅ on passe le route_type au helper
            geometryCoords = await buildRouteGeometry(orderedStops, route.route_type);
        }

        const processedRoute = {
            route_id: route.route_id,
            agency_id: route.agency_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_type: route.route_type,
            route_desc: route.route_desc,
            route_color: route.route_color,
            route_text_color: route.route_text_color,
            stops: orderedStops,
            bounds,
            geometry: {
                type: "LineString",
                coordinates: geometryCoords.length ? geometryCoords : orderedStops.map(s => [s.stop_lon, s.stop_lat])
            }
        };

        batch.push(processedRoute);

        if (batch.length === batchSize) {
            console.log(`Inserting batch of ${batch.length} processed routes (route ${routeIndex}/${routes.length})`);
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

    console.log(`ProcessedRoute file-based population completed. Inserted: ${insertedCount}`);
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
        // keep DB-based processed routes if you want to preserve the old behavior:
        // await populateProcessedRoutes(); // (this will use DB collections)
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
        await downloadGTFS();
        await extractGTFS();
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