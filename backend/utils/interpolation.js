// Utilities for mapping stops to route geometry and interpolating vehicle positions
function lerp(a, b, t) { return [a[0] + (b[0]-a[0]) * t, a[1] + (b[1]-a[1]) * t]; }

// Compute cumulative distances along a polyline (in naive degrees; for small spans ok). Could be improved with haversine.
function cumulativeDistances(coords) {
    const dists = [0];
    for (let i = 1; i < coords.length; i++) {
        const [lon1, lat1] = coords[i-1];
        const [lon2, lat2] = coords[i];
        const dx = lon2 - lon1;
        const dy = lat2 - lat1;
        const dist = Math.sqrt(dx*dx + dy*dy);
        dists.push(dists[i-1] + dist);
    }
    return dists;
}

// Map stops to nearest point along geometry returning distanceAlong
function mapStopsToGeometry(routeGeometryCoords, stops) {
    if (!routeGeometryCoords?.length || !stops?.length) return [];
    const cumDists = cumulativeDistances(routeGeometryCoords);
    return stops.map(stop => {
        const stopPoint = [stop.stop_lon, stop.stop_lat];
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < routeGeometryCoords.length; i++) {
            const p = routeGeometryCoords[i];
            const dx = p[0] - stopPoint[0];
            const dy = p[1] - stopPoint[1];
            const dist = dx*dx + dy*dy; // squared dist
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
        return { stop_id: stop.stop_id, geometryIndex: bestIdx, distanceAlong: cumDists[bestIdx] };
    });
}

function interpolateBetweenCoords(polylineCoords, startDist, endDist, targetDist) {
    if (!polylineCoords?.length) return null;
    const cumDists = cumulativeDistances(polylineCoords);
    const total = cumDists[cumDists.length - 1];
    if (targetDist <= 0) return polylineCoords[0];
    if (targetDist >= total) return polylineCoords[polylineCoords.length - 1];
    // Find segment
    let segIdx = 0;
    while (segIdx < cumDists.length - 1 && cumDists[segIdx + 1] < targetDist) segIdx++;
    const localFrac = (targetDist - cumDists[segIdx]) / (cumDists[segIdx + 1] - cumDists[segIdx]);
    return lerp(polylineCoords[segIdx], polylineCoords[segIdx + 1], localFrac);
}

// Determine progress along stops based on predicted times and now
function computeProgress(predictedEpochTimes, nowEpoch) {
    // predictedEpochTimes: array of seconds for each stop (arrival or departure reference)
    if (!predictedEpochTimes?.length) return null;
    for (let i = 0; i < predictedEpochTimes.length - 1; i++) {
        const t1 = predictedEpochTimes[i];
        const t2 = predictedEpochTimes[i+1];
        if (t1 == null || t2 == null) continue;
        if (nowEpoch >= t1 && nowEpoch <= t2) {
            const span = t2 - t1;
            const frac = span > 0 ? (nowEpoch - t1) / span : 0;
            return { prevStopIdx: i, nextStopIdx: i+1, fraction: Math.min(Math.max(frac, 0), 1) };
        }
    }
    // Before first or after last
    if (nowEpoch < predictedEpochTimes[0]) {
        return { prevStopIdx: 0, nextStopIdx: 1, fraction: 0 };
    }
    return { prevStopIdx: predictedEpochTimes.length - 2, nextStopIdx: predictedEpochTimes.length - 1, fraction: 1 };
}

module.exports = { mapStopsToGeometry, interpolateBetweenCoords, computeProgress, cumulativeDistances, lerp };
