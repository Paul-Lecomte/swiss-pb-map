"use client";
import React, { useEffect, useState, useRef, useMemo } from "react";
import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import StopMarker from "@/components/stopmarker/StopMarker";
import "leaflet/dist/leaflet.css";
import ZoomControl from "../zoom/ZoomControl";
import { fetchStopsInBbox } from "../../services/StopsApiCalls";
import MapLayerSwitcher, { layers } from "../maplayerswitcher/MapLayerSwitcher";
import { streamRoutesInBbox } from "../../services/RouteApiCalls";
import RouteLine from "@/components//route_line/RouteLine";
import Search from "@/components/search/Search";
import RouteInfoPanel from "@/components/routeinfopanel/RouteInfoPanel";
import Vehicle from "@/components/vehicle/Vehicle";
import { LayerState } from "../layer_option/LayerOption";
import StreamProgress from "@/components/progress/StreamProgress";

// Layer visibility state type
type LayerKeys = "railway" | "stations" | "tram" | "bus" | "trolleybus" | "ferry" | "backgroundPois";

const MapView  = ({ onHamburger, layersVisible, setLayersVisible }: { onHamburger: () => void; layersVisible: LayerState; setLayersVisible: React.Dispatch<React.SetStateAction<LayerState>> }) => {
    const [stops, setStops] = useState<any[]>([]);
    const [zoom, setZoom] = useState(13);
    const [tileLayer, setTileLayer] = useState(layers[0]);
    const [pendingStopId, setPendingStopId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [pendingCenter, setPendingCenter] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
    const [routes, setRoutes] = useState<any[]>([]);
    const mapRef = useRef<any>(null);
    const [selectedRoute, setSelectedRoute] = useState<any | null>(null);

    // Ajout pour le highlight
    const [highlightedRouteId, setHighlightedRouteId] = useState<string | null>(null);

    const handleRouteClick = (route: any) => {
        setSelectedRoute(route);
        setHighlightedRouteId(route.properties?.route_id || `${route.properties?.route_short_name}-${route.properties?.route_long_name}`);
    };

    const handleCloseRoutePanel = () => {
        setSelectedRoute(null);
        setHighlightedRouteId(null);
    };

    // Remove app:layer-visibility listeners — Header will update layersVisible directly

    // Listen to LayerOption toggle events only for backward compat if needed — but prefer lifted state
    useEffect(() => {
        const handler = (e: any) => {
            if (!e?.detail?.key) return;
            const { key, value } = e.detail;
            // keep parity: update lifted state if event fired
            if (key in layersVisible) {
                setLayersVisible(prev => ({ ...prev, [key]: value }));
            }
        };
        window.addEventListener("app:layer-visibility", handler as EventListener);
        return () => window.removeEventListener("app:layer-visibility", handler as EventListener);
    }, [layersVisible, setLayersVisible]);

    // Helper debounce function
    function debounce<F extends (...args: any[]) => void>(fn: F, delay: number) {
        let timeout: ReturnType<typeof setTimeout>;
        return (...args: Parameters<F>) => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

    // Expand a bbox by a relative ratio (e.g. 0.1 = 10%)
    function expandBbox(bbox: number[], ratio: number): number[] {
        const [minLng, minLat, maxLng, maxLat] = bbox;
        const dLng = (maxLng - minLng) * ratio;
        const dLat = (maxLat - minLat) * ratio;
        return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
    }

    const loadStops = async (bbox: number[], zoom: number, maxZoom: number) => {
        if (zoom === maxZoom) {
            const data = await fetchStopsInBbox(bbox, zoom);
            setStops(data.features || []);
        } else {
            setStops([]);
        }
    };

    const routesCacheRef = useRef<Map<string, { route: any; bboxes: number[][] }>>(new Map());
    const streamAbortRef = useRef<AbortController | null>(null);
    const rafScheduledRef = useRef(false);
    const [streamInfo, setStreamInfo] = useState<{ total?: number; received: number; elapsedMs?: number; loading: boolean }>({ received: 0, loading: false });

    // Abort ongoing stream on unmount
    useEffect(() => {
        return () => {
            if (streamAbortRef.current) {
                try { streamAbortRef.current.abort(); } catch {}
            }
        };
    }, []);

    const loadRoutesStreaming = async (bbox: number[], zoom: number) => {
        const bboxKey = bbox.join(",");

        const cachedRoutes = Array.from(routesCacheRef.current.values());
        const alreadyCached = cachedRoutes.length > 0 && cachedRoutes.every(c => c.bboxes.some(b => b.join(",") === bboxKey));
        if (alreadyCached) return;

        // Liste des route_ids connus pour minimiser le statique envoyé par le backend
        const knownIds = Array.from(routesCacheRef.current.keys());

        if (streamAbortRef.current) {
            try { streamAbortRef.current.abort(); } catch {}
        }
        const ac = new AbortController();
        streamAbortRef.current = ac;

        const expandedBbox = expandBbox(bbox, 0.1);

        const scheduleFlush = () => {
            if (rafScheduledRef.current) return;
            rafScheduledRef.current = true;
            requestAnimationFrame(() => {
                rafScheduledRef.current = false;
                setRoutes(Array.from(routesCacheRef.current.values()).map(c => c.route));
            });
        };

        try {
            setStreamInfo({ received: 0, loading: true });
            await streamRoutesInBbox(
              bbox,
              zoom,
              (feature) => {
                // Merge with cache: si static_included=false, réutiliser geometry/stops depuis le cache si disponibles
                const id = feature.properties?.route_id || `${feature.properties?.route_short_name}-${feature.properties?.route_long_name}`;
                const coords = feature.geometry?.coordinates || [];
                let intersects = false;
                if (Array.isArray(coords) && coords.length) {
                    intersects = coords.some((c: any) => {
                        const lon = Number(c[0]);
                        const lat = Number(c[1]);
                        return Number.isFinite(lat) && Number.isFinite(lon)
                          && lon >= expandedBbox[0] && lon <= expandedBbox[2]
                          && lat >= expandedBbox[1] && lat <= expandedBbox[3];
                    });
                } else if (routesCacheRef.current.has(id)) {
                    const cached = routesCacheRef.current.get(id)!.route;
                    const cc = cached.geometry?.coordinates || [];
                    intersects = Array.isArray(cc) && cc.some((c: any) => {
                        const lon = Number(c[0]);
                        const lat = Number(c[1]);
                        return Number.isFinite(lat) && Number.isFinite(lon)
                          && lon >= expandedBbox[0] && lon <= expandedBbox[2]
                          && lat >= expandedBbox[1] && lat <= expandedBbox[3];
                    });
                }
                if (!intersects) return;

                // Recompose feature si statique manquant
                if (!feature.geometry && routesCacheRef.current.has(id)) {
                    const cached = routesCacheRef.current.get(id)!.route;
                    feature.geometry = cached.geometry;
                    if (!feature.properties?.stops) feature.properties.stops = cached.properties?.stops;
                }

                // Convertit trip_schedules -> stop_times par stop (pour compat Vehicle)
                if (feature.properties && feature.properties.trip_schedules && feature.properties.stops) {
                    const schedules = feature.properties.trip_schedules as Array<{ trip_id: string; times: any[] }>;
                    const stopsArr = feature.properties.stops as any[];
                    const stopTimesByStop = stopsArr.map((s: any, stopIdx: number) => {
                        const arr: any[] = [];
                        for (let v = 0; v < schedules.length; v++) {
                            const pair = schedules[v].times?.[stopIdx];
                            if (!pair) { arr.push({}); continue; }
                            if (Array.isArray(pair)) {
                                // compact mode [arrSec, depSec] => reconstruit HH:MM:SS pour compat
                                const toTime = (sec: number | null) => {
                                    if (sec == null || !isFinite(sec)) return undefined;
                                    const h = Math.floor(sec / 3600);
                                    const m = Math.floor((sec % 3600) / 60);
                                    const s = Math.floor(sec % 60);
                                    const pad = (n: number) => String(n).padStart(2, '0');
                                    return `${pad(h)}:${pad(m)}:${pad(s)}`;
                                };
                                arr.push({
                                    arrival_time: toTime(pair[0] ?? null),
                                    departure_time: toTime(pair[1] ?? null)
                                });
                            } else {
                                // non-compact: déjà sous forme {arrival_time, departure_time}
                                arr.push({ arrival_time: pair.arrival_time, departure_time: pair.departure_time });
                            }
                        }
                        return arr;
                    });
                    // Injecte stop_times reconstruits dans stops
                    for (let i = 0; i < stopsArr.length; i++) {
                        (stopsArr[i] as any).stop_times = stopTimesByStop[i] || [];
                    }
                    // Nettoie schedule pour réduire la mémoire client
                    delete feature.properties.trip_schedules;
                }

                if (routesCacheRef.current.has(id)) {
                    const entry = routesCacheRef.current.get(id)!;
                    entry.route = feature.geometry ? feature : { ...feature, geometry: entry.route.geometry };
                    if (!entry.bboxes.some(b => b.join(",") === bboxKey)) entry.bboxes.push(bbox);
                } else {
                    routesCacheRef.current.set(id, { route: feature, bboxes: [bbox] });
                }
                scheduleFlush();
                setStreamInfo(prev => ({ ...prev, received: prev.received + 1 }));
              },
              {
                signal: ac.signal,
                knownIds,
                includeStatic: true,
                compactTimes: true,
                maxTrips: 24,
                decimals: 5,
                concurrency: 10,
                onMeta: (m) => setStreamInfo(prev => ({ ...prev, total: m.totalRoutes })),
                onEnd: (e) => setStreamInfo(prev => ({ ...prev, loading: false, elapsedMs: e.elapsedMs }))
              }
            );

            for (const [id, cached] of routesCacheRef.current.entries()) {
                const inBbox = cached.route.geometry?.coordinates?.some(([lng, lat]: [number, number]) =>
                    lng >= expandedBbox[0] && lng <= expandedBbox[2] && lat >= expandedBbox[1] && lat <= expandedBbox[3]
                );
                if (!inBbox) routesCacheRef.current.delete(id);
            }
            setRoutes(Array.from(routesCacheRef.current.values()).map(c => c.route));
        } catch (e: any) {
            if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
                // silently ignore
            } else {
                console.error('[Map] streamRoutesInBbox failed', e);
            }
            setStreamInfo(prev => ({ ...prev, loading: false }));
        }
    };

    function MapRefBinder() {
        const map = useMap();
        const loggedRef = React.useRef(false);

        useEffect(() => {
            if (map && !loggedRef.current) {
                console.log("[Map] MapRefBinder: map attached");
                mapRef.current = map as any; // avoid referencing L.Map in TS shim
                setMapReady(true);
                loggedRef.current = true;
            }
        }, [map]);
        return null;
    }

    function MapEvents() {
        const debouncedLoad = useRef(
            debounce((bbox: number[], currentZoom: number, maxZoom: number) => {
                loadStops(bbox, currentZoom, maxZoom);
                loadRoutesStreaming(bbox, currentZoom);
            }, 650)
        ).current;

        // A timeout to delay the "stop moving" detection
        const moveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

        useMapEvents({
            move: (e: any) => {
                // Clear any pending timeout if user keeps moving
                if (moveTimeout.current) clearTimeout(moveTimeout.current);

                // When user stops for 500ms, then trigger
                moveTimeout.current = setTimeout(() => {
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
                    debouncedLoad(bbox, currentZoom, maxZoom);
                }, 500);
            },

            zoomend: (e: any) => {
                // Also trigger when zooming stops
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
                debouncedLoad(bbox, currentZoom, maxZoom);
            },
        });

        return null;
    }

    useEffect(() => {
        const bbox = [6.5, 46.5, 6.7, 46.6];
        loadStops(bbox, 13, 17);
        loadRoutesStreaming(bbox, 13);
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

    // Helpers to detect route modes from properties
    const trainTypes = new Set([
        'S','SN','R','TGV','IC','IC1','IC2','IC3','IC5','IC6','IC8','IC21',
        'IR','IR13','IR15','IR16','IR17','IR26','IR27','IR35','IR36','IR37','IR46','IR57','IR65','IR66','IR70',
        'RE','RE33','RE37','RE48','S40','S41','EXT','EC','ICE','TGV Lyria','Thalys'
    ]);
    const tramTypes = new Set(['Tram','T','T1','T2','T3','T4','T5','T6','T7','T8']);
    const busTypes = new Set(['Bus','B','B1','B2','B3','B4','B5','B6','B7','B8']);
    const trolleybusTypes = new Set(['Trolleybus','TB']);
    const ferryTypes = new Set(['Ferry','F','F1','F2','F3','3100','N1','N2','3150','BAT']);

    const detectRouteMode = (route: any): LayerKeys | null => {
        const props = route?.properties || {};
        const shortName: string = props.route_short_name || "";
        const type: string = props.route_type || "";
        if (shortName === "m2" && type === "401") return "tram";
        if (shortName === "m1" && type === "401") return "tram";
        const desc: string = props.route_desc || shortName || "";
        const token = (desc || shortName || "").trim();
        const upper = token.toUpperCase();
        if (trainTypes.has(token) || upper.startsWith('S') || upper.startsWith('IC') || upper.startsWith('EV') || upper.startsWith('IR') || upper.startsWith('RE')) return 'railway';
        if (tramTypes.has(token) || upper.startsWith('T')) return 'tram';
        if (trolleybusTypes.has(token) || upper.startsWith('TB')) return 'trolleybus';
        if (ferryTypes.has(token)) return 'ferry';
        if (busTypes.has(token) || upper.startsWith('B')) return 'bus';
        return null;
    };

    const uniqueRoutes = Object.values(
        routes.reduce((acc: Record<string, any>, route: any) => {
            const id =
                route.properties?.route_id ||
                `${route.properties?.route_short_name}-${route.properties?.route_long_name}`;

            // Only keep the first route with this id
            if (!acc[id]) acc[id] = route;
            return acc;
        }, {})
    );

    // Compute visible routes once so we can render lines and vehicles consistently
    const visibleRoutes = useMemo(() => uniqueRoutes.filter((route: any) => {
        if (highlightedRouteId) {
            const id =
                route.properties?.route_id ||
                `${route.properties?.route_short_name}-${route.properties?.route_long_name}`;
            return id === highlightedRouteId;
        }
        const mode = detectRouteMode(route);
        if (mode === "railway") return layersVisible.railway;
        if (mode === "tram") return layersVisible.tram;
        if (mode === "bus") return layersVisible.bus;
        if (mode === "trolleybus") return layersVisible.trolleybus;
        if (mode === "ferry") return layersVisible.ferry;
        return true;
    }), [uniqueRoutes, highlightedRouteId, layersVisible]);

    const showAllRoutes = layersVisible.showRoutes;
    const showAllVehicles = layersVisible.showVehicles;

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
                zoom={zoom}
                maxZoom={tileLayer.maxZoom || 17}
                zoomControl={false}
                style={{ position: "relative", width: "100%", height: "100%" }}
                whenCreated={(mapInstance: any) => {
                    mapRef.current = mapInstance as any;
                    setMapReady(true);
                }}
            >
                <StreamProgress total={streamInfo.total} received={streamInfo.received} elapsedMs={streamInfo.elapsedMs} loading={streamInfo.loading} />
                <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} maxZoom={tileLayer.maxZoom} maxNativeZoom={tileLayer.maxZoom} />

                <ZoomControl />
                <MapRefBinder />
                <MapEvents />

                {/* Route lines */}
                {showAllRoutes && visibleRoutes.map((route: any) => {
                    const id = route.properties?.route_id || `${route.properties?.route_short_name}-${route.properties?.route_long_name}`;
                    return (
                        <RouteLine
                            key={id}
                            route={route}
                            color={route.properties?.route_color}
                            onClick={() => handleRouteClick(route)}
                            highlighted={highlightedRouteId === id}
                        />
                    );
                })}

                {/* Vehicles */}
                {showAllVehicles && visibleRoutes.map((route: any) => {
                    const id = route.properties?.route_id || `${route.properties?.route_short_name}-${route.properties?.route_long_name}`;
                    const coords = route.geometry?.coordinates || [];
                    if (!coords || coords.length < 2) return null;

                    const positions = coords
                        .map((c: any) => {
                            const lon = Number(c[0]);
                            const lat = Number(c[1]);
                            if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
                            return null;
                        })
                        .filter(Boolean) as [number, number][];

                    const stops = route.properties?.stops || [];
                    // Si le backend a renvoyé des trip_schedules non convertis (fallback), construire des stopTimes minimalistes
                    let vehicleDepartures = stops[0]?.stop_times || [];
                    if ((!vehicleDepartures || vehicleDepartures.length === 0) && Array.isArray(route.properties?.trip_schedules)) {
                        const schedules = route.properties.trip_schedules as Array<{ trip_id: string; times: any[] }>;
                        vehicleDepartures = schedules.map(s => ({ arrival_time: s.times?.[0]?.[0], departure_time: s.times?.[0]?.[1] }));
                    }

                    return vehicleDepartures.map((departure: any, idx: number) => {
                        const stopTimesForVehicle = stops.map((s: any) => ({
                            stop_id: s.stop_id,
                            stop_lat: s.stop_lat,
                            stop_lon: s.stop_lon,
                            arrival_time: s.stop_times?.[idx]?.arrival_time,
                            departure_time: s.stop_times?.[idx]?.departure_time,
                            stop_sequence: s.stop_sequence,
                        }));

                        const validStopTimesCount = stopTimesForVehicle.filter(
                            (st: any) => st.arrival_time || st.departure_time
                        ).length;
                        if (validStopTimesCount < 2) return null;

                        return (
                            <Vehicle
                                key={`veh-${id}-${idx}`}
                                routeId={id}
                                routeShortName={route.properties?.route_short_name}
                                coordinates={positions}
                                stopTimes={stopTimesForVehicle}
                                color={route.properties?.route_color || "#264653"}
                                isRunning={true}
                                onClick={() => handleRouteClick(route)}
                            />
                        );
                    });
                })}

                {selectedRoute && (
                    <RouteInfoPanel
                        route={selectedRoute}
                        onClose={handleCloseRoutePanel}
                    />
                )}

                {/* Stops */}
                {layersVisible.stations && stops
                    .filter((stop: any) =>
                        (stop.properties.routes && stop.properties.routes.length > 0) ||
                        stop.properties.stop_id === pendingStopId
                    )
                    .map((stop: any, idx: number) => (
                        <StopMarker key={idx} stop={stop} />
                    ))
                }

                <MapLayerSwitcher selectedLayer={tileLayer.name} onChange={(name) => {
                    const layer = layers.find(l => l.name === name);
                    if (layer) setTileLayer(layer);
                }} />
            </MapContainer>
        </div>
    );
};

export default MapView;
