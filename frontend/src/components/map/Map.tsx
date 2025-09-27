import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import StopMarker from "@/components/stopmarker/StopMarker";
import "leaflet/dist/leaflet.css";
import ZoomControl from "../zoom/ZoomControl";
import { fetchStopsInBbox } from "../../services/StopsApiCalls";
import MapLayerSwitcher, { layers } from "../maplayerswitcher/MapLayerSwitcher";
import Search from "@/components/search/Search";
import L from "leaflet";

const Map = ({ onHamburger }: { onHamburger: () => void }) => {
    const [stops, setStops] = useState<any[]>([]);
    const [zoom, setZoom] = useState(13);
    const [tileLayer, setTileLayer] = useState(layers[0]);
    const [pendingStopId, setPendingStopId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const mapRef = useRef<L.Map | null>(null);

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

    // Handler pour l'événement de sélection d'arrêt
    useEffect(() => {
        const handler = (e: any) => {
            if (e && e.detail) {
                const stop = e.detail;
                console.log("[Map] app:stop-select reçu :", stop);
                const exists = stops.some((s: any) =>
                    (s.properties?.stop_id ?? s.stop_id) === stop.stop_id
                );
                if (!exists && stop.stop_lat && stop.stop_lon) {
                    console.log("[Map] Ajout du stop dans stops :", stop.stop_id);
                    setStops(prev => [
                        ...prev,
                        {
                            type: "Feature",
                            geometry: {
                                type: "Point",
                                coordinates: [stop.stop_lon, stop.stop_lat]
                            },
                            properties: { ...stop }
                        }
                    ]);
                    setPendingStopId(stop.stop_id);
                } else {
                    console.log("[Map] Stop déjà présent, on set pendingStopId :", stop.stop_id);
                    setPendingStopId(stop.stop_id);
                }
            }
        };
        window.addEventListener("app:stop-select", handler as EventListener);
        return () => {
            window.removeEventListener("app:stop-select", handler as EventListener);
        };
    }, [stops]);

    // Effet pour centrer/zoomer dès que le marker est bien présent
    useEffect(() => {
        if (!pendingStopId || !mapReady || !mapRef.current) return;
        const stop = stops.find(
            (s: any) => (s.properties?.stop_id ?? s.stop_id) === pendingStopId
        );
        if (!stop) return;
        const lat = stop.properties?.stop_lat ?? stop.stop_lat;
        const lon = stop.properties?.stop_lon ?? stop.stop_lon;
        if (
            typeof lat === "number" &&
            typeof lon === "number" &&
            !isNaN(lat) &&
            !isNaN(lon)
        ) {
            console.log("[Map] Avant setView, zoom actuel :", mapRef.current.getZoom());
            mapRef.current.setView([lat, lon], 18, { animate: true });
            console.log("[Map] Après setView, zoom actuel :", mapRef.current.getZoom());
            let attempts = 0;
            const tryOpen = () => {
                attempts += 1;
                const opened = openPopupForCoords(lat, lon);
                if (opened) {
                    setPendingStopId(null);
                    return;
                }
                if (attempts < 15) setTimeout(tryOpen, 120);
                else setPendingStopId(null);
            };
            setTimeout(tryOpen, 250);
        } else {
            setPendingStopId(null);
        }
    }, [stops, pendingStopId, mapReady]);

    const openPopupForCoords = (lat: number, lon: number) => {
        if (!mapRef.current) return false;
        let opened = false;
        const tol = 1e-5;
        mapRef.current.eachLayer((layer: any) => {
            if (typeof layer.getLatLng === "function") {
                const ll = layer.getLatLng();
                if (ll && Math.abs(ll.lat - lat) < tol && Math.abs(ll.lng - lon) < tol && typeof layer.openPopup === "function") {
                    layer.openPopup();
                    opened = true;
                }
            }
        });
        return opened;
    };

    return (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 0 }}>
            <div style={{
                position: "absolute",
                top: 16,
                left: 16,
                width: "auto",
                display: "flex",
                justifyContent: "flex-start",
                zIndex: 100
            }}>
                <Search
                    onHamburger={onHamburger}
                    onStopSelect={() => {}} // tout passe par l'event
                />
            </div>
            <MapContainer
                center={[46.516, 6.63282]}
                zoom={13}
                maxZoom={18}
                zoomControl={false}
                style={{ position: "relative", width: "100%", height: "100%" }}
                whenCreated={mapInstance => {
                    mapRef.current = mapInstance;
                    setMapReady(true);
                }}
            >
                <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />

                <ZoomControl />
                <MapEvents />
                {stops
                    .filter((stop: any) => stop.properties.routes && stop.properties.routes.length > 0)
                    .map((stop: any, idx: number) => (
                        <StopMarker key={idx} stop={stop} />
                    ))}

                <MapLayerSwitcher selectedLayer={tileLayer.name} onChange={(name) => {
                    const layer = layers.find(l => l.name === name);
                    if (layer) setTileLayer(layer);
                }} />
            </MapContainer>
        </div>
    );
};

export default Map;