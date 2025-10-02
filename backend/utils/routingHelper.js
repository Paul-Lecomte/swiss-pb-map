const axios = require('axios');

async function getRouteBetweenStops(stopA, stopB, profile = 'driving') {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${stopA.stop_lon},${stopA.stop_lat};${stopB.stop_lon},${stopB.stop_lat}?geometries=geojson`;

    try {
        const response = await axios.get(url);
        const coords = response.data.routes[0].geometry.coordinates;
        return coords; // [[lon,lat], [lon,lat], ...]
    } catch (err) {
        console.error("OSRM error:", err.message);
        // fallback: juste ligne droite si problème
        return [[stopA.stop_lon, stopA.stop_lat], [stopB.stop_lon, stopB.stop_lat]];
    }
}

module.exports = { getRouteBetweenStops };