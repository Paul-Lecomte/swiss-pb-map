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
const { buildRouteGeometry, mapRouteTypeToProfile, findTrainIdsByRouteNameLive, findTrainIdsByRouteNameMultiTenant, toWGS84IfNeeded, isLikelyLonLat, fetchMultiTenantTrajectoriesIndex } = require('./routingHelper');

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

//TODO : Fix current problem with the swisstne data not giving out accurate results for some routes

async function populateProcessedRoutesFromFiles() {
    // Cache for lines with no geOps candidates discovered in Phase 1
    const NO_CANDIDATE_CACHE = new Map(); // key=normalized line name -> timestamp ms
    const GEOPS_RETRY_TTL_MS = parseInt(process.env.GEOPS_RETRY_TTL_MS || "300000", 10);
    function normalizeLineNameLocal(name) {
        if (!name) return "";
        return String(name).toUpperCase().replace(/\s+/g, "").replace(/[.-]/g, "");
    }
    console.log('Starting file-based population of ProcessedRoute (memory-efficient)...');
    await ProcessedRoute.deleteMany({});
    console.log('Cleared ProcessedRoute collection.');

    const routes = await parseCSV('routes.txt', Route, 'Route', { saveToDB: false });
    const counts = await countStopTimesPerTrip('stop_times.txt');
    const mainTripForRoute = await findMainTripsForRoutes('trips.txt', counts);
    const mainTripIds = new Set(mainTripForRoute.values());

    const stopTimesMap = await collectStopTimesForTripIds('stop_times.txt', mainTripIds);
    const stopMap = await buildStopMap('stops.txt');

    const batchSizePhase1 = parseInt(process.env.ROUTES_BATCH_SIZE_PHASE1 || process.env.ROUTES_BATCH_SIZE || "50", 10);
    const batchSizePhase2 = parseInt(process.env.ROUTES_BATCH_SIZE_PHASE2 || process.env.ROUTES_BATCH_SIZE || "50", 10);
    let batch = [];
    let insertedCount = 0;

    // Defer routes with no live geOps train_id candidates
    const deferredRoutes = [];
    let geOpsCandidateRoutes = 0;
    let insertedPhase1 = 0;

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        if (routeIndex % 10 === 0 || routeIndex === 0) {
            console.log(`Building route ${routeIndex + 1}/${routes.length} (route_id=${route.route_id})`);
        }

        const mainTripId = mainTripForRoute.get(route.route_id);
        let orderedStops = [];

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
                        stop_sequence: parseInt(st.stop_sequence || '0')
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

        // If not enough stops, build straight line later in fallback phase
        if (orderedStops.length < 2) {
            deferredRoutes.push({ route, orderedStops, bounds });
            continue;
        }

        try {
            console.log(`➡️  Computing geometry for route_type=${route.route_type} (${orderedStops.length} stops)...`);

            // 🟢 Try using geOps live trajectories feed to discover train_id by line name
            let trainIdCandidates = [];
            try {
                trainIdCandidates = await findTrainIdsByRouteNameLive(
                    route.route_short_name,
                    route.route_long_name,
                    { bounds }
                );
                if (trainIdCandidates && trainIdCandidates.length) {
                    const preview = trainIdCandidates.slice(0, 5).join(", ");
                    console.log(`🔎 [Live] geOps candidates for ${route.route_short_name || route.route_id}: [${preview}] (${trainIdCandidates.length} total)`);
                } else {
                    // Try multi-tenant discovery before deferring
                    const multi = await findTrainIdsByRouteNameMultiTenant(
                        route.route_short_name,
                        route.route_long_name,
                        { bounds }
                    );
                    if (multi && multi.length) {
                        trainIdCandidates = multi;
                        const preview = trainIdCandidates.slice(0, 5).join(", ");
                        console.log(`🔎 [Live Multi] geOps candidates for ${route.route_short_name || route.route_id}: [${preview}] (${trainIdCandidates.length} total)`);
                    } else {
                        console.log(`🕗 [Defer] No [Live] geOps train_id candidates for ${route.route_short_name || route.route_id}; deferring to end`);
                        // Remember lines with no candidates to avoid geOps-retry later (TTL)
                        const tNow = Date.now();
                        const ns = normalizeLineNameLocal(route.route_short_name);
                        const nl = normalizeLineNameLocal(route.route_long_name);
                        if (ns) NO_CANDIDATE_CACHE.set(ns, tNow);
                        if (nl) NO_CANDIDATE_CACHE.set(nl, tNow);
                        deferredRoutes.push({ route, orderedStops, bounds });
                        continue; // do not compute fallbacks now
                    }
                }
            } catch (e) {
                console.warn(`⚠️ [Live] train_id lookup failed for ${route.route_short_name || route.route_id}:`, e.message);
                console.log(`🕗 [Defer] Live lookup failed; deferring ${route.route_short_name || route.route_id} to end`);
                deferredRoutes.push({ route, orderedStops, bounds });
                continue;
            }

            // We have candidates: attempt geOps, then immediate fallback if needed
            geOpsCandidateRoutes++;
            const geometryCoords = await buildRouteGeometry(
                orderedStops,
                route.route_type,
                2,
                trainIdCandidates,
                { geOpsOnly: true }
            );

            // If geOps did not return usable geometry, defer to Phase 2 (do not run fallbacks now)
            if (!geometryCoords || geometryCoords.length < 2) {
                console.log(`🕗 [Defer: geOps-failed] No usable geOps geometry for ${route.route_short_name || route.route_id}; deferring to end`);
                deferredRoutes.push({ route, orderedStops, bounds });
                continue;
            }

            // Ensure geometry is stored as [lon, lat] (WGS84)
            let coordsPhase1 = (geometryCoords && geometryCoords.length)
                ? geometryCoords
                : orderedStops.map(s => [s.stop_lon, s.stop_lat]);
            if (coordsPhase1.length && !isLikelyLonLat(coordsPhase1[0])) {
                coordsPhase1 = toWGS84IfNeeded(coordsPhase1);
                console.log(`🌍 [Phase1] Converted geometry to WGS84 for ${route.route_short_name || route.route_id}`);
            }

            const processedRoute = {
                route_id: route.route_id,
                agency_id: route.agency_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                route_desc: route.route_desc,
                route_color: route.route_color || await getRouteColor(route.route_short_name),
                route_text_color: route.route_text_color,
                stops: orderedStops,
                bounds,
                geometry: {
                    type: "LineString",
                    coordinates: coordsPhase1
                }
            };

            batch.push(processedRoute);

            if (batch.length === batchSizePhase1) {
                console.log(`Inserting batch of ${batch.length} processed routes (Phase1)`);
                await ProcessedRoute.insertMany(batch, { ordered: false });
                insertedCount += batch.length;
                insertedPhase1 += batch.length;
                batch = [];
            }

        } catch (err) {
            console.error(`❌ Failed to build geometry for route ${route.route_id}:`, err.message);
            // On unexpected failure, defer to Phase 2 as a safeguard
            deferredRoutes.push({ route, orderedStops, bounds });
        }
    }

    // Flush any remaining Phase 1 batch
    if (batch.length > 0) {
        console.log(`Inserting final batch of ${batch.length} processed routes (Phase1)`);
        await ProcessedRoute.insertMany(batch, { ordered: false });
        insertedCount += batch.length;
        insertedPhase1 += batch.length;
        batch = [];
    }

    // Phase 2: process deferred routes with fallbacks
    console.log(`📊 [Phase1] geOps-candidate routes processed: ${geOpsCandidateRoutes}. Deferred (no train_id or lookup failure): ${deferredRoutes.length}.`);

    let insertedDeferred = 0;
    const PHASE2_CONCURRENCY = Math.max(1, parseInt(process.env.PHASE2_CONCURRENCY || "8", 10));
    const PHASE2_GEOM_PARALLELISM = parseInt(process.env.PHASE2_GEOM_PARALLELISM || process.env.ROUTE_GEOM_PARALLELISM || "4", 10);
    const PHASE2_SKIP_GEOPS = String(process.env.PHASE2_SKIP_GEOPS || "true").toLowerCase() !== "false";

    console.log(`🧵 [Phase2] Starting with concurrency=${PHASE2_CONCURRENCY}, batchSize=${batchSizePhase2}${PHASE2_SKIP_GEOPS ? ' | geOps-retry=SKIPPED' : ''}`);

    // Prefetch multi-tenant indices once to reduce repeated API calls (only if not skipping geOps in Phase 2)
    if (!PHASE2_SKIP_GEOPS) {
        try {
            await fetchMultiTenantTrajectoriesIndex();
        } catch {}
    }

    const PHASE2_ROUTE_TIMEOUT_ENABLED = (() => {
        const raw = process.env.PHASE2_ROUTE_TIMEOUT_ENABLED;
        if (raw === undefined || raw === null) return false; // par défaut activé
        return String(raw).toLowerCase() !== 'false';
    })();

    const PHASE2_ROUTE_TIMEOUT_MS = (() => {
        const v = parseInt(process.env.PHASE2_ROUTE_TIMEOUT_MS || "120000", 10);
        return isNaN(v) ? 120000 : v;
    })();

    function nowMs() { return Date.now(); }
    function msStr(ms) { return `${Math.round(ms)}ms`; }

    async function withTimeout(promise, timeoutMs) {
        // Si le timeout global est désactivé ou la valeur de timeout <= 0 => attendre la promesse sans limite
        if (!PHASE2_ROUTE_TIMEOUT_ENABLED || !timeoutMs || timeoutMs <= 0) {
            try {
                const res = await promise;
                return { timedOut: false, result: res };
            } catch (err) {
                throw err;
            }
        }

        let toHandle;
        const timeoutPromise = new Promise(resolve => {
            toHandle = setTimeout(() => resolve({ timedOut: true, result: null }), timeoutMs);
        });

        const result = await Promise.race([promise.then(r => ({ timedOut: false, result: r })), timeoutPromise]);
        if (toHandle) clearTimeout(toHandle);
        return result;
    }

    let processedPhase2 = 0;
    let heartbeatTimer = null;
    function startHeartbeat(total) {
        const startTs = nowMs();
        heartbeatTimer = setInterval(() => {
            const elapsed = (nowMs() - startTs) / 1000;
            const rate = processedPhase2 / Math.max(1, elapsed);
            const remaining = total - processedPhase2;
            const etaSec = rate > 0 ? Math.round(remaining / rate) : 0;
            console.log(`⏱️ [Phase2] Progress ${processedPhase2}/${total} | elapsed=${Math.round(elapsed)}s | eta≈${etaSec}s`);
        }, 60000);
    }
    function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

    startHeartbeat(deferredRoutes.length);

    let idx = 0;
    const inFlight = new Set();

    async function processOne(item, index) {
        const { route, orderedStops, bounds } = item;
        console.log(`🛟 [Deferred Phase2] Processing ${index + 1}/${deferredRoutes.length} route_id=${route.route_id}`);

        const tStart = nowMs();
        let tGeOps = 0, tBuild = 0, tInsert = 0;
        let geometryCoords = [];

        // First: re-try geOps in Phase 2 using live feeds (SBB, then multi-tenant) — optionally skipped
        if (!PHASE2_SKIP_GEOPS) {
            try {
                let retryCandidates = [];

                // Skip geOps-retry if Phase 1 already had no candidates for this line name and TTL not expired
                const tNow = Date.now();
                const ns = normalizeLineNameLocal(route.route_short_name);
                const nl = normalizeLineNameLocal(route.route_long_name);
                const tsNs = ns ? NO_CANDIDATE_CACHE.get(ns) : null;
                const tsNl = nl ? NO_CANDIDATE_CACHE.get(nl) : null;
                const skipRetry = ((tsNs && (tNow - tsNs) < GEOPS_RETRY_TTL_MS) || (tsNl && (tNow - tsNl) < GEOPS_RETRY_TTL_MS));

                const t0 = nowMs();
                if (!skipRetry) {
                    try {
                        retryCandidates = await findTrainIdsByRouteNameLive(
                            route.route_short_name,
                            route.route_long_name,
                            { bounds }
                        );
                        if (retryCandidates && retryCandidates.length) {
                            const prev = retryCandidates.slice(0, 5).join(", ");
                            console.log(`🔁 [Phase2 geOps-retry] [Live] candidates for ${route.route_short_name || route.route_id}: [${prev}] (${retryCandidates.length} total)`);
                        } else {
                            const multi = await findTrainIdsByRouteNameMultiTenant(
                                route.route_short_name,
                                route.route_long_name,
                                { bounds }
                            );
                            if (multi && multi.length) {
                                retryCandidates = multi;
                                const prev = retryCandidates.slice(0, 5).join(", ");
                                console.log(`🔁 [Phase2 geOps-retry] [Live Multi] candidates for ${route.route_short_name || route.route_id}: [${prev}] (${retryCandidates.length} total)`);
                            } else {
                                console.log(`ℹ️ [Phase2 geOps-retry] No live candidates for ${route.route_short_name || route.route_id}`);
                            }
                        }
                    } catch (e) {
                        console.warn(`⚠️ [Phase2 geOps-retry] Lookup failed for ${route.route_short_name || route.route_id}: ${e.message}`);
                    }
                } else {
                    console.log(`⏭️  [Phase2 geOps-retry] Skipping geOps lookup for ${route.route_short_name || route.route_id} (cached no-candidate within TTL)`);
                }

                if (retryCandidates && retryCandidates.length) {
                    const res = await withTimeout(
                        buildRouteGeometry(
                            orderedStops,
                            route.route_type,
                            PHASE2_GEOM_PARALLELISM,
                            retryCandidates,
                            { geOpsOnly: true }
                        ),
                        Math.max(20000, Math.floor(PHASE2_ROUTE_TIMEOUT_MS / 2))
                    );
                    tGeOps += (nowMs() - t0);
                    if (!res.timedOut) {
                        const apiCoords = res.result;
                        if (apiCoords && apiCoords.length > 1) {
                            geometryCoords = apiCoords;
                            console.log(`✅ [Phase2 geOps-retry] Using geOps geometry for ${route.route_short_name || route.route_id}`);
                        }
                    } else {
                        console.log(`⏱️ [Phase2 geOps-retry] Timed out for ${route.route_short_name || route.route_id} after ${msStr(Math.max(20000, Math.floor(PHASE2_ROUTE_TIMEOUT_MS / 2)))}`);
                    }
                } else {
                    tGeOps += (nowMs() - t0);
                }
            } catch (e) {
                console.warn(`⚠️ [Phase2 geOps-retry] Attempt error for ${route.route_id}: ${e.message}`);
            }
        } else {
            // Skipped by configuration
            console.log(`⏭️  [Phase2] geOps retry skipped by PHASE2_SKIP_GEOPS for ${route.route_short_name || route.route_id}`);
        }

        // If geOps still not available, run fallbacks now with a watchdog
        if (!geometryCoords || geometryCoords.length < 2) {
            const t1 = nowMs();
            try {
                const res = await withTimeout(
                    buildRouteGeometry(
                        orderedStops,
                        route.route_type,
                        PHASE2_GEOM_PARALLELISM,
                        null // no trainId list, trigger fallbacks
                    ),
                    PHASE2_ROUTE_TIMEOUT_MS
                );
                if (!res.timedOut) {
                    geometryCoords = res.result;
                } else {
                    console.warn(`⏱️ [Deferred Phase2] Route timeout after ${msStr(PHASE2_ROUTE_TIMEOUT_MS)} for ${route.route_id}. Using straight lines.`);
                    geometryCoords = null;
                }
            } catch (err) {
                console.warn(`⚠️ [Deferred Phase2] Fallback build failed for ${route.route_id}: ${err.message}. Using straight lines.`);
                geometryCoords = null;
            } finally {
                tBuild += (nowMs() - t1);
            }
        }

        // Ensure WGS84 and fill straight line if still missing
        let finalCoords = (geometryCoords && geometryCoords.length)
            ? geometryCoords
            : orderedStops.map(s => [s.stop_lon, s.stop_lat]);
        if (finalCoords.length && !isLikelyLonLat(finalCoords[0])) {
            finalCoords = toWGS84IfNeeded(finalCoords);
            console.log(`🌍 [Phase2] Converted geometry to WGS84 for ${route.route_short_name || route.route_id}`);
        }

        const processedRoute = {
            route_id: route.route_id,
            agency_id: route.agency_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_type: route.route_type,
            route_desc: route.route_desc,
            route_color: route.route_color || await getRouteColor(route.route_short_name),
            route_text_color: route.route_text_color,
            stops: orderedStops,
            bounds,
            geometry: {
                type: "LineString",
                coordinates: finalCoords
            }
        };

        batch.push(processedRoute);
        if (batch.length >= batchSizePhase2) {
            const toInsert = batch;
            batch = [];
            try {
                console.log(`Inserting batch of ${toInsert.length} processed routes (Deferred Phase2)`);
                await ProcessedRoute.insertMany(toInsert, { ordered: false });
                insertedCount += toInsert.length;
                insertedDeferred += toInsert.length;
            } catch (e) {
                console.warn(`⚠️ Batch insert failed in Phase2: ${e.message}. Attempting single inserts.`);
                for (const pr of toInsert) {
                    try { await ProcessedRoute.create(pr); insertedCount++; insertedDeferred++; } catch {}
                }
            }
        }
        // Update Phase 2 progress counter for heartbeat
        processedPhase2++;
    }

    async function pump() {
        while (idx < deferredRoutes.length && inFlight.size < PHASE2_CONCURRENCY) {
            const curIndex = idx++;
            const p = processOne(deferredRoutes[curIndex], curIndex).then(() => inFlight.delete(p)).catch(() => inFlight.delete(p));
            inFlight.add(p);
        }
        if (inFlight.size > 0) {
            await Promise.race(inFlight);
            return pump();
        }
    }

    await pump();

    if (batch.length > 0) {
        console.log(`Inserting final batch of ${batch.length} processed routes (Deferred Phase2)`);
        await ProcessedRoute.insertMany(batch, { ordered: false });
        insertedCount += batch.length;
        insertedDeferred += batch.length;
        batch = [];
    }

    console.log(`📊 [Phase2] Deferred processed: ${insertedDeferred}`);
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
