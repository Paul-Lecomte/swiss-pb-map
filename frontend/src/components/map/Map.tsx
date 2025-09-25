import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ZoomControl from "../zoom/ZoomControl";
import { fetchStopsInBbox } from "../../services/StopsApiCalls";

const busIcon = '/icons/bus_marker.png';
const metroIcon = '/icons/metro_marker.png';
const trainIcon = '/icons/train_marker.png';

const createLeafletIcon = (iconUrl: string) =>
    new L.Icon({
        iconUrl,
        iconSize: [24, 24],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
    });

const Map = () => {
    const [stops, setStops] = useState([]);
    const [zoom, setZoom] = useState(13);

    const loadStops = async (bbox: number[], zoom: number, maxZoom: number) => {
        if (zoom === maxZoom) {
            const data = await fetchStopsInBbox(bbox, zoom);
            setStops(data.features || []);
        } else {
            setStops([]);
        }
    };

    function MapEvents() {
        useMapEvents({
            moveend: (e) => {
                const map = e.target;
                const bounds = map.getBounds();
                const bbox = [
                    bounds.getSouthWest().lng,
                    bounds.getSouthWest().lat,
                    bounds.getNorthEast().lng,
                    bounds.getNorthEast().lat,
                ];
                const currentZoom = map.getZoom();
                const maxZoom = map.getMaxZoom();
                setZoom(currentZoom);
                loadStops(bbox, currentZoom, maxZoom);
            },
            zoomend: (e) => {
                const map = e.target;
                const bounds = map.getBounds();
                const bbox = [
                    bounds.getSouthWest().lng,
                    bounds.getSouthWest().lat,
                    bounds.getNorthEast().lng,
                    bounds.getNorthEast().lat,
                ];
                const currentZoom = map.getZoom();
                const maxZoom = map.getMaxZoom();
                setZoom(currentZoom);
                loadStops(bbox, currentZoom, maxZoom);
            }
        });
        return null;
    }

    useEffect(() => {
        const bbox = [6.5, 46.5, 6.7, 46.6];
        loadStops(bbox, 13, 18);
    }, []);

    function getStopIcon(routeDesc: string) {
        switch (routeDesc) {
            case 'M': // Metro
                return createLeafletIcon(metroIcon);
            case 'B': // Bus
                return createLeafletIcon(busIcon);
            case 'T': // Tram
                return createLeafletIcon(tramIcon);
            case 'S': // Regional train
            case 'SN': // Night train
            case 'R': // Regional
            case 'EV': // Express / special
            case 'TGV': // High-speed
                return createLeafletIcon(trainIcon);
            case 'F': // Ferry / boat
                return createLeafletIcon(ferryIcon);
            case 'C': // Cable car / funicular / gondola
                return createLeafletIcon(cableIcon);
            default: // fallback
                return createLeafletIcon(busIcon);
        }
    }

    return (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 0 }}>
            <MapContainer
                center={[46.516, 6.63282]}
                zoom={13}
                maxZoom={18}
                zoomControl={false}
                style={{ position: "relative", width: "100%", height: "100%" }}
            >
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
                    subdomains={["a", "b", "c", "d"]}
                />
                <ZoomControl />
                <MapEvents />
                {stops
                    .filter((stop: any) => stop.properties.routes && stop.properties.routes.length > 0) // only stops with routes
                    .map((stop: any, idx: number) => {
                        const lat = stop.stop_lat ?? stop.geometry?.coordinates[1];
                        const lon = stop.stop_lon ?? stop.geometry?.coordinates[0];
                        const name = stop.stop_name ?? stop.properties?.stop_name;
                        const routeDesc = stop.properties.routes[0].route_desc; // safe now

                        return (
                            <Marker
                                key={idx}
                                position={[lat, lon]}
                                icon={getStopIcon(routeDesc)}
                            >
                                <Popup>
                                    <strong>{name}</strong>
                                    <br />
                                    Routes: {stop.properties.routes.map((r: any) => r.route_short_name).join(", ")}
                                </Popup>
                            </Marker>
                        );
                    })}
            </MapContainer>
        </div>
    );
};

export default Map;