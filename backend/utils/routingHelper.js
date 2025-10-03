// backend/utils/routingHelper.js
const axios = require('axios');

/**
 * Mappe un GTFS route_type vers un profil OSRM
 * (OSRM supporte seulement driving, cycling, walking)
 */
function mapRouteTypeToProfile(routeType) {
    switch (parseInt(routeType, 10)) {
        case 0: // Tram, Light rail
        case 1: // Subway
        case 2: // Rail
        case 4: // Ferry
        case 5: // Cable car
        case 6: // Gondola
        case 7: // Funicular
            return 'driving'; // fallback sur "driving" car OSRM ne supporte pas ces modes
        case 3: // Bus
            return 'driving';
        case 11: // Trolleybus
            return 'driving';
        case 12: // Monorail
            return 'driving';
        default:
            return 'driving';
    }
}

/**
 * Construit une géométrie complète entre tous les arrêts d’un trajet
 * en un seul appel OSRM (plus rapide et précis).
 */
async function buildRouteGeometry(orderedStops, routeType = 3) {
    if (!orderedStops || orderedStops.length < 2) return [];

    const profile = mapRouteTypeToProfile(routeType);

    const coords = orderedStops.map(s => `${s.stop_lon},${s.stop_lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

    try {
        const response = await axios.get(url);
        if (response.data && response.data.routes && response.data.routes[0]) {
            return response.data.routes[0].geometry.coordinates;
        }
    } catch (err) {
        console.error("OSRM error:", err.message);
    }

    // fallback : simple ligne droite entre arrêts
    return orderedStops.map(s => [s.stop_lon, s.stop_lat]);
}

/**
 * Ancienne version segment-par-segment (gardée si besoin).
 */
async function getRouteBetweenStops(stopA, stopB, profile = 'driving') {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${stopA.stop_lon},${stopA.stop_lat};${stopB.stop_lon},${stopB.stop_lat}?geometries=geojson`;

    try {
        const response = await axios.get(url);
        return response.data.routes[0].geometry.coordinates;
    } catch (err) {
        console.error("OSRM error:", err.message);
        return [[stopA.stop_lon, stopA.stop_lat], [stopB.stop_lon, stopB.stop_lat]];
    }
}

module.exports = {
    buildRouteGeometry,
    getRouteBetweenStops,
    mapRouteTypeToProfile
};