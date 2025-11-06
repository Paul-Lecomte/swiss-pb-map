// TODO fix the no return of the stops times most like due to wrong filtering

const asyncHandler = require('express-async-handler');
const { DateTime } = require('luxon');
const ProcessedRoute = require('../model/processedRoutesModel');
const ProcessedStopTimes = require('../model/processedStopTimesModel');

// helper: get current weekday string in GTFS format
const getCurrentWeekday = () => {
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    return weekdays[DateTime.now().setZone('Europe/Zurich').weekday % 7]; // Luxon: Monday=1..Sunday=7
};

// helper: convert GTFS HH:mm:ss string to seconds past midnight
const gtfsTimeToSeconds = (timeStr) => {
    if (!timeStr) return null;
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};

const getRoutesInBbox = asyncHandler(async (req, res) => {
    const { bbox } = req.query;
    if (!bbox) return res.status(400).json({ error: "bbox missing" });

    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

    const routes = await ProcessedRoute.find({
        'bounds.min_lat': { $lte: maxLat },
        'bounds.max_lat': { $gte: minLat },
        'bounds.min_lon': { $lte: maxLng },
        'bounds.max_lon': { $gte: minLng },
        straight_line: false
    })
        .limit(150)
        .lean();

    if (!routes.length) return res.json({ type: "FeatureCollection", features: [] });

    const tripIds = routes.map(r => r.trip_id).filter(Boolean);
    if (!tripIds.length) return res.json({ type: "FeatureCollection", features: [] });

    const allStopTimes = await ProcessedStopTimes.find(
        { trip_id: { $in: tripIds } },
        { trip_id: 1, stop_times: 1, route_start_time: 1, route_stop_time: 1, calendar: 1, calendar_dates: 1 }
    ).lean();

    const stopTimesMap = {};
    allStopTimes.forEach(doc => {
        stopTimesMap[doc.trip_id] = doc;
    });

    const now = DateTime.now().setZone('Europe/Zurich');
    const todayStr = now.toFormat('yyyyLLdd'); // YYYYMMDD
    const weekday = getCurrentWeekday();

    const currentSeconds = now.hour * 3600 + now.minute * 60 + now.second;

    const features = routes.map(route => {
        const doc = stopTimesMap[route.trip_id];
        if (!doc) return null;

        const routeStartSec = gtfsTimeToSeconds(doc.route_start_time);
        const routeStopSec = gtfsTimeToSeconds(doc.route_stop_time);

        // first filter stop_times by route start/stop times
        let filteredStopTimes = doc.stop_times.filter(st => {
            const tSec = gtfsTimeToSeconds(st.arrival_time || st.departure_time);
            if (tSec === null) return false;
            return tSec >= routeStartSec && tSec <= routeStopSec;
        });

        // then filter by current day using calendar/calendar_dates
        filteredStopTimes = filteredStopTimes.filter(() => {
            let valid = false;
            const cal = doc.calendar;
            if (cal) valid = cal[weekday] === '1';

            if (doc.calendar_dates && doc.calendar_dates.length) {
                doc.calendar_dates.forEach(cd => {
                    if (cd.date === todayStr) {
                        valid = cd.exception_type === '1'; // 1=added service, 2=removed service
                    }
                });
            }
            return valid;
        });

        const stopsWithTimes = route.stops.map(stop => {
            const st = filteredStopTimes.filter(s => s.stop_id === stop.stop_id);
            return { ...stop, stop_times: st };
        });

        return {
            type: "Feature",
            geometry: route.geometry,
            properties: {
                route_id: route.route_id,
                trip_id: route.trip_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                route_desc: route.route_desc,
                bounds: route.bounds,
                route_color: route.route_color,
                route_text_color: route.route_text_color,
                stops: stopsWithTimes
            }
        };
    }).filter(Boolean);

    res.json({ type: "FeatureCollection", features });
});

module.exports = { getRoutesInBbox };