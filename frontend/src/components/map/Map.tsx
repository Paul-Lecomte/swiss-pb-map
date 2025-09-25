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
            case 'M':
                return createLeafletIcon(metroIcon);
            case 'B':
                return createLeafletIcon(busIcon);
            case 'EV':
            case 'S':
            case 'SN':
                return createLeafletIcon(trainIcon);
            default:
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
                {stops.map((stop: any, idx: number) => (
                    <Marker
                        key={idx}
                        position={[
                            stop.geometry.coordinates[1], // lat
                            stop.geometry.coordinates[0], // lng
                        ]}
                        icon={getStopIcon(stop.properties.routeDesc)}
                    >
                        <Popup>{stop.properties.name}</Popup>
                    </Marker>
                ))}
            </MapContainer>
        </div>
    );
};

export default Map;