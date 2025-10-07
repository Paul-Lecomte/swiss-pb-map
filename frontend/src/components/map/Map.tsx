"use client";
import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import StopMarker from "@/components/stopmarker/StopMarker";
import "leaflet/dist/leaflet.css";
import ZoomControl from "../zoom/ZoomControl";
import { fetchStopsInBbox } from "../../services/StopsApiCalls";
import MapLayerSwitcher, { layers } from "../maplayerswitcher/MapLayerSwitcher";
import { fetchRoutesInBbox } from "../../services/RouteApiCalls";
import RouteLine from "@/components//route_line/RouteLine";
import Search from "@/components/search/Search";
import RouteInfoPanel from "@/components/routeinfopanel/RouteInfoPanel";
import L from "leaflet";

const MapView  = ({ onHamburger }: { onHamburger: () => void }) => {
    const [stops, setStops] = useState<any[]>([]);
    const [zoom, setZoom] = useState(13);
    const [tileLayer, setTileLayer] = useState(layers[0]);
    const [pendingStopId, setPendingStopId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [pendingCenter, setPendingCenter] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
    const [routes, setRoutes] = useState<any[]>([]);
    const mapRef = useRef<L.Map | null>(null);
    const [selectedRoute, setSelectedRoute] = useState<any | null>(null);
    const handleCloseRoutePanel = () => setSelectedRoute(null);

    const loadStops = async (bbox: number[], zoom: number, maxZoom: number) => {
        if (zoom === maxZoom) {
            const data = await fetchStopsInBbox(bbox, zoom);
            setStops(data.features || []);
        } else {
            setStops([]);
        }
    };

    function isRouteInBbox(route: any, bbox: number[]): boolean {
        if (!route?.geometry?.coordinates?.length) return false;
        const [minLng, minLat, maxLng, maxLat] = bbox;
        return route.geometry.coordinates.some(([lng, lat]: [number, number]) =>
            lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
        );
    }

    function expandBbox(bbox: number[], ratio: number): number[] {
        const [minLng, minLat, maxLng, maxLat] = bbox;
        const dLng = (maxLng - minLng) * ratio;
        const dLat = (maxLat - minLat) * ratio;
        return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
    }

    const routesCacheRef = useRef<Map<string, any>>(new Map());

    const loadRoutes = async (bbox: number[], zoom: number) => {
        const data = await fetchRoutesInBbox(bbox, zoom);
        const fetched = data.features || [];

        // Fusionner avec le cache
        fetched.forEach((r: any) => {
            const id = r.properties?.route_id || `${r.properties?.route_short_name}-${r.properties?.route_long_name}`;
            routesCacheRef.current.set(id, r);
        });

        // On garde uniquement les routes proches de la bbox (pour éviter un cache infini)
        const expandedBbox = expandBbox(bbox, 0.1); // 10% de marge
        for (const [id, route] of routesCacheRef.current.entries()) {
            if (!isRouteInBbox(route, expandedBbox)) {
                routesCacheRef.current.delete(id);
            }
        }

        // Met à jour la state avec le cache actuel
        setRoutes(Array.from(routesCacheRef.current.values()));
    };

    function MapRefBinder() {
        const map = useMap();
        const loggedRef = React.useRef(false);

        useEffect(() => {
            if (map && !loggedRef.current) {
                console.log("[Map] MapRefBinder: map attached");
                mapRef.current = map as unknown as L.Map;
                setMapReady(true);
                loggedRef.current = true;
            }
        }, [map]);
        return null;
    }

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
                loadRoutes(bbox, currentZoom);
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
                loadRoutes(bbox, currentZoom);
            }
        });
        return null;
    }

    useEffect(() => {
        const bbox = [6.5, 46.5, 6.7, 46.6];
        loadStops(bbox, 13, 17);
        loadRoutes(bbox, 13);
    }, []);

    // Handler for "app:stop-select" event
    useEffect(() => {
        const handler = (e: any) => {
            if (e && e.detail) {
                const stop = e.detail;
                console.log("[Map] app:stop-select reçu :", stop);
                // Center and zoom immediately on the selected stop
                const latNum = typeof stop.stop_lat === "string" ? parseFloat(stop.stop_lat) : stop.stop_lat;
                const lonNum = typeof stop.stop_lon === "string" ? parseFloat(stop.stop_lon) : stop.stop_lon;
                console.log("[Map] stop-select parsed lat/lon:", latNum, lonNum, "mapReady:", mapReady, "mapRef exists:", !!mapRef.current);
                if (typeof latNum === "number" && typeof lonNum === "number" && !isNaN(latNum) && !isNaN(lonNum)) {
                    const mapMax = mapRef.current?.getMaxZoom ? mapRef.current.getMaxZoom() : (tileLayer?.maxZoom ?? 17);
                    const targetZoom = Math.min(mapMax, tileLayer?.maxZoom ?? mapMax ?? 17);
                    console.log("[Map] computed targetZoom:", targetZoom, "mapMax:", mapMax, "layerMax:", tileLayer?.maxZoom);
                    // Queue the centering so it also works if the map instance isn’t ready yet
                    setPendingCenter({ lat: latNum, lon: lonNum, zoom: targetZoom });
                    if (mapRef.current) {
                        try {
                            console.log("[Map] immediate setView() call");
                            mapRef.current.invalidateSize();
                            mapRef.current.setView([latNum, lonNum], targetZoom, { animate: true });
                        } catch (err) {
                            console.warn("[Map] setView failed, fallback to panTo", err);
                            try { mapRef.current.panTo([latNum, lonNum]); } catch (e2) { console.error("[Map] panTo failed", e2); }
                        }
                    } else {
                        console.log("[Map] mapRef not ready, will center via pendingCenter effect");
                    }
                }
                const exists = stops.some((s: any) =>
                    (s.properties?.stop_id ?? s.stop_id) === stop.stop_id
                );
                if (!exists && latNum != null && lonNum != null && !isNaN(latNum) && !isNaN(lonNum)) {
                    console.log("[Map] Ajout du stop dans stops :", stop.stop_id);
                    setStops(prev => [
                        ...prev,
                        {
                            type: "Feature",
                            geometry: {
                                type: "Point",
                                coordinates: [lonNum, latNum]
                            },
                            properties: { ...stop, stop_lat: latNum, stop_lon: lonNum }
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
    }, [stops, tileLayer]);

    // Effect: apply any queued centering once the map is ready
    useEffect(() => {
        if (!pendingCenter || !mapRef.current || !mapReady) return;
        const { lat, lon, zoom: desired } = pendingCenter;
        const mapMax = mapRef.current.getMaxZoom ? mapRef.current.getMaxZoom() : (tileLayer?.maxZoom ?? 17);
        const targetZoom = Math.min(desired ?? mapMax, mapMax);
        console.log("[Map] pendingCenter effect: applying center", { lat, lon, desired, mapMax, targetZoom, mapReady });
        try {
            mapRef.current.invalidateSize();
            mapRef.current.setView([lat, lon], targetZoom, { animate: true });
            console.log("[Map] pendingCenter effect: setView called");
        } catch (e) {
            console.warn("[Map] pendingCenter effect: setView failed, panTo fallback", e);
            try { mapRef.current.panTo([lat, lon]); } catch (e2) { console.error("[Map] pendingCenter effect: panTo failed", e2); }
        }
        setPendingCenter(null);
    }, [pendingCenter, mapReady, tileLayer]);

    // effect: open popup for pendingStopId once map and stops are ready
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
            console.log("[Map] mapRef.current:", mapRef.current);
            console.log("[Map] Avant setView, zoom actuel :", mapRef.current.getZoom());
            mapRef.current.flyTo([lat, lon], 17, { animate: true });
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
                maxZoom={tileLayer.maxZoom || 17}
                zoomControl={false}
                style={{ position: "relative", width: "100%", height: "100%" }}
                whenCreated={mapInstance => {
                    console.log("[Map] whenCreated: map instance ready", !!mapInstance);
                    mapRef.current = mapInstance;
                    setMapReady(true);
                    console.log("[Map] mapReady set to true");
                }}
            >
                <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} maxZoom={tileLayer.maxZoom} maxNativeZoom={tileLayer.maxZoom} />

                <ZoomControl />
                <MapRefBinder />
                <MapEvents />

                {routes.map((route: any, idx: number) => (
                    <RouteLine
                        key={idx}
                        route={route}
                        color={route.properties?.route_color}
                        onClick={() => setSelectedRoute(route)}
                    />
                ))}

                {selectedRoute && (
                    <RouteInfoPanel
                        route={selectedRoute}
                        onClose={handleCloseRoutePanel}
                    />
                )}

                {stops
                    // Keep normal filter but allow pending stop even without routes
                    .filter((stop: any) =>
                        (stop.properties.routes && stop.properties.routes.length > 0) ||
                        stop.properties.stop_id === pendingStopId
                    )
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

export default MapView;