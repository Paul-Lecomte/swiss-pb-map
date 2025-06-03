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

const pipeline = promisify(stream.pipeline);
const DATA_DIR = path.join(__dirname, 'gtfs_data');
const ZIP_FILE_PATH = path.join(DATA_DIR, 'gtfs.zip');
const GTFS_BASE_URL = 'https://data.opentransportdata.swiss/en/dataset/timetable-2025-gtfs2020';

// Ensure the data directory exists
if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DATA_DIR, { recursive: true });

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

// To do : add a system of batch to not have a overload
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
    await saveGTFSData(ProcessedStop, processedStops, 'ProcessedStop');
}

async function downloadGTFS() {
    console.log('Downloading GTFS data...');
    try {
        const latestGTFSLink = await getLatestGTFSLink();
        const response = await axios({ url: latestGTFSLink, method: 'GET', responseType: 'stream' });
        await pipeline(response.data, fs.createWriteStream(ZIP_FILE_PATH));
        console.log('Download complete.');
    } catch (error) {
        console.error('Error downloading GTFS data:', error);
    }
}

async function extractGTFS() {
    console.log('Extracting GTFS data...');
    try {
        const directory = await unzipper.Open.file(ZIP_FILE_PATH);
        await Promise.all(directory.files.map(file => {
            return new Promise((resolve, reject) => {
                file.stream()
                    .pipe(fs.createWriteStream(path.join(DATA_DIR, file.path)))
                    .on('finish', resolve)
                    .on('error', reject);
            });
        }));
        console.log('GTFS data extracted successfully');
    } catch (error) {
        console.error('Error extracting GTFS data:', error);
    }
}

async function parseCSV(fileName, model, name) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        console.log(`File ${fileName} not found, skipping...`);
        return;
    }

    console.log(`Processing ${fileName}...`);

    return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(filePath);
        const parser = parse({
            columns: (header) => header.map(col => col.trim().toLowerCase()), // Normalize column headers
            relax_column_count: true,
            skip_empty_lines: true,
        });

        let count = 0;
        const batchSize = 100000;
        const entriesToInsert = [];

        parser.on('data', (data) => {
            entriesToInsert.push(data);
            count++;

            if (count === batchSize) {
                parser.pause();
                saveGTFSData(model, entriesToInsert, name)
                    .then(() => {
                        entriesToInsert.length = 0; // Clear batch
                        count = 0;
                        parser.resume();
                    })
                    .catch(reject);
            }
        });

        parser.on('end', async () => {
            if (entriesToInsert.length) {
                await saveGTFSData(model, entriesToInsert, name);
            }
            console.log(`Finished processing ${fileName}.`);
            resolve();
        });

        parser.on('error', (err) => {
            console.error(`Error parsing ${fileName}:`, err);
            reject(err);
        });

        readStream.pipe(parser);
    });
}

async function saveGTFSData(model, data, name) {
    if (!data.length) return;

    try {
        console.log(`Inserting ${data.length} records into ${name} collection...`);
        await model.insertMany(data, { ordered: false });
        console.log(`Inserted ${data.length} records into DB.`);
    } catch (error) {
        console.error(`Error saving ${name}:`, error);
    }
}

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

        // Clear existing data for each collection before inserting new data
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
                await parseCSV(file, model, name);
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

// Run the script
updateGTFSData().catch(err => {
    console.error('Error updating GTFS data:', err);
    mongoose.connection.close();
    process.exit(1);
});