/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/* @ts-nocheck */
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useRef, useMemo } from "react";
import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import StopMarker from "@/components/stopmarker/StopMarker";
import "leaflet/dist/leaflet.css";
import ZoomControl from "../zoom/ZoomControl";
import { fetchStopsInBbox } from "../../services/StopsApiCalls";
import MapLayerSwitcher, { layers } from "../maplayerswitcher/MapLayerSwitcher";
import { streamRoutesInBbox } from "../../services/RouteApiCalls";
import { realtimeUpdatesByTripIds } from "../../services/RealtimeApiCalls";
import RouteLine from "@/components//route_line/RouteLine";
import Search from "@/components/search/Search";
import RouteInfoPanel from "@/components/routeinfopanel/RouteInfoPanel";
import Vehicle from "@/components/vehicle/Vehicle";
import { LayerState } from "../layer_option/LayerOption";
import StreamProgress from "@/components/progress/StreamProgress";


// Layer visibility state type
type LayerKeys = "railway" | "stations" | "tram" | "bus" | "trolleybus" | "ferry" | "backgroundPois";

const MapView  = ({ onHamburger, layersVisible, setLayersVisible, optionPrefs }: { onHamburger: () => void; layersVisible: LayerState; setLayersVisible: React.Dispatch<React.SetStateAction<LayerState>>; optionPrefs?: { showRealtimeOverlay: boolean; showRouteProgress: boolean } }) => {
    const [stops, setStops] = useState<any[]>([]);
    const [zoom, setZoom] = useState(13);
    const [tileLayer, setTileLayer] = useState(layers[0]);
    const [pendingStopId, setPendingStopId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [pendingCenter, setPendingCenter] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
    const [routes, setRoutes] = useState<any[]>([]);
    const mapRef = useRef<any>(null);
    const [selectedRoute, setSelectedRoute] = useState<any | null>(null);
    const [selectedTripIndex, setSelectedTripIndex] = useState<number | null>(null);
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

    // Ajout pour le highlight
    const [highlightedRouteId, setHighlightedRouteId] = useState<string | null>(null);

    const handleRouteClick = (route: any) => {
        setSelectedRoute(route);
        setHighlightedRouteId(route.properties?.route_id || `${route.properties?.route_short_name}-${route.properties?.route_long_name}`);
        setSelectedTripIndex(null);
        setSelectedTripId(null);
    };

    const handleVehicleClick = (route: any, vehicleIdx: number, tripId?: string) => {
        setSelectedRoute(route);
        setHighlightedRouteId(route.properties?.route_id || `${route.properties?.route_short_name}-${route.properties?.route_long_name}`);
        setSelectedTripIndex(vehicleIdx);
        setSelectedTripId(tripId ?? null);
    };

    const handleCloseRoutePanel = () => {
        setSelectedRoute(null);
        setHighlightedRouteId(null);
        setSelectedTripIndex(null);
        setSelectedTripId(null);
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

    const routesCacheRef = useRef<Map<string, { route: any; bboxes: number[][]; lastAccess: number }>>(new Map());
    const MAX_ROUTE_CACHE_ENTRIES = 200; // hard cap to avoid memory overuse
    const TARGET_ROUTE_CACHE_ENTRIES = 100; // shrink-to size after eviction
    // Cache eviction helper (LRU-ish prioritizing entries outside current bbox)
    const evictCacheIfNeeded = (currentBbox?: number[]) => {
        const cache = routesCacheRef.current;
        if (cache.size <= MAX_ROUTE_CACHE_ENTRIES) return;
        const currentKey = currentBbox ? currentBbox.join(',') : null;
        const entries = [...cache.entries()].map(([id, entry]) => ({
            id,
            lastAccess: entry.lastAccess || 0,
            hasCurrentBbox: currentKey ? entry.bboxes.some(b => b.join(',') === currentKey) : false
        })).sort((a,b) => a.lastAccess - b.lastAccess);
        // First pass: remove oldest not in current bbox
        for (const e of entries) {
            if (cache.size <= TARGET_ROUTE_CACHE_ENTRIES) break;
            if (!e.hasCurrentBbox) cache.delete(e.id);
        }
        // Second pass: if still too big, remove oldest regardless
        if (cache.size > TARGET_ROUTE_CACHE_ENTRIES) {
            for (const e of entries) {
                if (cache.size <= TARGET_ROUTE_CACHE_ENTRIES) break;
                if (cache.has(e.id)) cache.delete(e.id);
            }
        }
        // Update rendered routes after eviction
        setRoutes(Array.from(cache.values()).map(c => c.route));
    };

    const streamAbortRef = useRef<AbortController | null>(null);
    // Nouveau: référence vers worker
    const routeWorkerRef = useRef<Worker | null>(null);
    const rafScheduledRef = useRef(false);
    const [streamInfo, setStreamInfo] = useState<{ total?: number; received: number; elapsedMs?: number; loading: boolean }>({ received: 0, loading: false });

    // Maintain last bbox route ids to compute diffs and avoid re-rendering same features
    const lastBboxRoutesRef = useRef<Set<string>>(new Set());
    const prevBboxRef = useRef<number[] | null>(null);

    // Streaming concurrency/queueing control
    const isStreamingRef = useRef(false);

    // Clear caches and abort streams on tab close / navigation away / prolonged hidden
    useEffect(() => {
        const handleUnload = () => {
            try { if (streamAbortRef.current) streamAbortRef.current.abort(); } catch {}
            try { routesCacheRef.current.clear(); } catch {}
            setRoutes([]);
        };
        const handleVisibility = () => {
            if (document.hidden) {
                // After 60s hidden, clear to free memory
                const timeoutId = setTimeout(() => {
                    if (document.hidden) {
                        try { routesCacheRef.current.clear(); } catch {}
                        setRoutes([]);
                    }
                }, 60000);
                // If user returns earlier, cancel
                const cancel = () => clearTimeout(timeoutId);
                document.addEventListener('visibilitychange', cancel, { once: true });
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('pagehide', handleUnload);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('pagehide', handleUnload);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    // Abort ongoing stream on unmount only
    useEffect(() => {
        return () => {
            if (streamAbortRef.current) {
                try { streamAbortRef.current.abort(); } catch {}
            }
        };
    }, []);

    // Empêche les appels à l'API des routes si une routeline est ouverte
    const routeLineOpenRef = useRef<boolean>(false);
    useEffect(() => {
        routeLineOpenRef.current = !!selectedRoute;
    }, [selectedRoute]);

    // Remove any cached routes that are not relevant to the new bbox before starting a fresh stream
    const pruneCacheForNewBbox = (bbox: number[]) => {
        const cache = routesCacheRef.current;
        const newKey = bbox.join(',');
        let changed = false;
        for (const [id, entry] of cache.entries()) {
            if (!entry.bboxes.some(b => b.join(',') === newKey)) {
                cache.delete(id);
                changed = true;
            }
        }
        if (changed) setRoutes(Array.from(cache.values()).map(c => c.route));
    };

    const requestRoutes = async (bbox: number[], zoom: number) => {
        if (routeLineOpenRef.current) return; // skip if route detail panel open
        // Abort any in-flight stream so we don't keep piling data
        if (isStreamingRef.current && streamAbortRef.current) {
            try { streamAbortRef.current.abort(); } catch {}
            isStreamingRef.current = false;
        }
        pruneCacheForNewBbox(bbox);
        isStreamingRef.current = true;
        try {
            await loadRoutesStreaming(bbox, zoom);
        } finally {
            isStreamingRef.current = false;
        }
    };

    const loadRoutesStreaming = async (bbox: number[], zoom: number) => {
        if (routeLineOpenRef.current) return; // safety
        const bboxKey = bbox.join("\,");
        const cachedRoutes = Array.from(routesCacheRef.current.values());
        const alreadyCached = cachedRoutes.length > 0 && cachedRoutes.every(c => c.bboxes.some(b => b.join("\,") === bboxKey));
        if (alreadyCached) {
            prevBboxRef.current = bbox;
            return;
        }
        const knownIds = Array.from(routesCacheRef.current.keys());
        const expandedBbox = expandBbox(bbox, 0.1);
        const scheduleFlush = () => {
            if (rafScheduledRef.current) return;
            rafScheduledRef.current = true;
            requestAnimationFrame(() => {
                rafScheduledRef.current = false;
                setRoutes(Array.from(routesCacheRef.current.values()).map(c => c.route));
            });
        };
        const maxTripsByZoom = zoom >= 15 ? 50 : zoom >= 13 ? 50 : 50;
        // Setup abort controller for this stream
        const abortController = new AbortController();
        streamAbortRef.current = abortController;

        if (routeWorkerRef.current) {
            setStreamInfo({ received: 0, loading: true });
            const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const worker = routeWorkerRef.current;
            return await new Promise<void>((resolve) => {
                const onMessage = (ev: MessageEvent) => {
                    const msg = ev.data;
                    if (!msg) return;
                    if (msg.type === 'meta') {
                        setStreamInfo(prev => ({ ...prev, total: msg.data.filteredRoutes ?? msg.data.totalRoutes }));
                    } else if (msg.type === 'features') {
                        for (const feature of msg.features) {
                            const id = feature.properties?.route_id || `${feature.properties?.route_short_name}-${feature.properties?.route_long_name}`;
                            if (!id) continue;
                            let intersects = false;
                            const coords = feature.geometry?.coordinates || [];
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
                            if (!intersects) continue;
                            if (routesCacheRef.current.has(id)) {
                                const entry = routesCacheRef.current.get(id)!;
                                entry.route = feature.geometry ? feature : { ...feature, geometry: entry.route.geometry };
                                if (!entry.bboxes.some(b => b.join("\,") === bboxKey)) entry.bboxes.push(bbox);
                                entry.lastAccess = Date.now();
                            } else {
                                routesCacheRef.current.set(id, { route: feature, bboxes: [bbox], lastAccess: Date.now() });
                            }
                        }
                        scheduleFlush();
                        setStreamInfo(prev => ({ ...prev, received: prev.received + msg.features.length }));
                        evictCacheIfNeeded(bbox);
                    } else if (msg.type === 'end') {
                        setStreamInfo(prev => ({ ...prev, loading: false, elapsedMs: msg.data.elapsedMs }));
                        worker.removeEventListener('message', onMessage);
                        resolve();
                    } else if (msg.type === 'error') {
                        console.error('[Map] worker stream error', msg.message);
                        setStreamInfo(prev => ({ ...prev, loading: false }));
                        worker.removeEventListener('message', onMessage);
                        resolve();
                    }
                };
                worker.addEventListener('message', onMessage);
                worker.postMessage({
                    cmd: 'stream',
                    apiBase: (process as any)?.env?.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api',
                    bbox,
                    zoom,
                    knownIds,
                    includeStatic: true,
                    maxTrips: maxTripsByZoom,
                    concurrency: 10,
                    onlyNew: true,
                    stream: true,
                    batchSize: 30,
                    batchMs: 150,
                    token
                });
            });
        }

        // Fallback direct streaming
        try {
            setStreamInfo({ received: 0, loading: true });
            const returnedThisCall = new Set<string>();
            await streamRoutesInBbox(
                bbox,
                zoom,
                (feature) => {
                    const id = feature.properties?.route_id || `${feature.properties?.route_short_name}-${feature.properties?.route_long_name}`;
                    if (!id) return;
                    returnedThisCall.add(id);
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
                    if (routesCacheRef.current.has(id)) {
                        const entry = routesCacheRef.current.get(id)!;
                        entry.route = feature.geometry ? feature : { ...feature, geometry: entry.route.geometry };
                        if (!entry.bboxes.some(b => b.join("\,") === bboxKey)) entry.bboxes.push(bbox);
                        entry.lastAccess = Date.now();
                    } else {
                        routesCacheRef.current.set(id, { route: feature, bboxes: [bbox], lastAccess: Date.now() });
                    }
                    scheduleFlush();
                    setStreamInfo(prev => ({ ...prev, received: prev.received + 1 }));
                    evictCacheIfNeeded(bbox);
                },
                {
                    signal: abortController.signal,
                    knownIds,
                    includeStatic: true,
                    maxTrips: maxTripsByZoom,
                    concurrency: 10,
                    onlyNew: true,
                    onMeta: (m) => setStreamInfo(prev => ({ ...prev, total: m.filteredRoutes ?? m.totalRoutes })),
                    onEnd: (e) => setStreamInfo(prev => ({ ...prev, loading: false, elapsedMs: e.elapsedMs }))
                }
            );
            const prevIds = lastBboxRoutesRef.current;
            for (const oldId of prevIds) {
                if (!returnedThisCall.has(oldId)) {
                    routesCacheRef.current.delete(oldId);
                }
            }
            lastBboxRoutesRef.current = returnedThisCall;
            prevBboxRef.current = bbox;
            setRoutes(Array.from(routesCacheRef.current.values()).map(c => c.route));
        } catch (e: any) {
            if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
                // aborted due to new bbox request; clear in-flight partial data not in new bbox
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
        // When the map is moved/zoomed we want to wait until the camera has
        // stopped moving for 3 seconds before calling the routes API. This
        // avoids heavy streaming calls while the user is actively panning/zooming.
        const STOP_DELAY_MS = 4000;
        const moveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

        const triggerLoad = (map: any) => {
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
            // loadStops is allowed to run immediately for stops (lighter), but
            // requestRoutes will only run when the camera stopped for STOP_DELAY_MS.
            loadStops(bbox, currentZoom, maxZoom);
            if (!routeLineOpenRef.current) requestRoutes(bbox, currentZoom);
        };

        useMapEvents({
            move: (e: any) => {
                // Clear any pending timeout if user keeps moving
                if (moveTimeout.current) clearTimeout(moveTimeout.current);
                // Set a new timeout: only when the camera has been idle for STOP_DELAY_MS
                moveTimeout.current = setTimeout(() => {
                    triggerLoad(e.target);
                    moveTimeout.current = null;
                }, STOP_DELAY_MS);
            },

            zoomend: (e: any) => {
                // Clear previous timeout and schedule the same stop-detection delay
                if (moveTimeout.current) clearTimeout(moveTimeout.current);
                moveTimeout.current = setTimeout(() => {
                    triggerLoad(e.target);
                    moveTimeout.current = null;
                }, STOP_DELAY_MS);
            },
        });

        return null;
    }

    useEffect(() => {
        const bbox = [6.5, 46.5, 6.7, 46.6];
        loadStops(bbox, 13, 17);
        if (!routeLineOpenRef.current) requestRoutes(bbox, 13);
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps

    const showAllRoutes = layersVisible.showRoutes;
    const showAllVehicles = layersVisible.showVehicles;

    // Realtime data state
    const [rtData, setRtData] = useState<any>(null);
    const rtTimerRef = useRef<number | null>(null);
    const inFlightRtRef = useRef<boolean>(false);
    const visibleTripIdsRef = useRef<string[]>([]);
    const lastTripHashRef = useRef<string>('');
    const lastCallAtRef = useRef<number>(0);

    // Met à jour la liste des tripIds visibles à chaque changement de routes visibles (pas d'appel réseau ici)
    useEffect(() => {
        const tripIds = new Set<string>();
        const currentVisible = (visibleRoutes as any[]) || [];
        for (const route of currentVisible) {
            const schedules = route?.properties?.trip_schedules as Array<{ trip_id: string }> | undefined;
            if (Array.isArray(schedules)) {
                for (const sch of schedules) {
                    if (sch?.trip_id) tripIds.add(sch.trip_id);
                }
            }
        }
        const ids = Array.from(tripIds);
        visibleTripIdsRef.current = ids;
    }, [visibleRoutes]);

    // Polling 15s stable (indépendant des changements de routes)
    useEffect(() => {
        async function tick() {
            if (inFlightRtRef.current) return;
            const now = Date.now();
            // Throttle dur local: quoi qu'il arrive, pas plus fréquent que 15s
            if (now - lastCallAtRef.current < 15000) return;
            inFlightRtRef.current = true;
            try {
                if (document.hidden) return; // réduit la charge si onglet caché
                const ids = visibleTripIdsRef.current || [];
                const hash = ids.length ? ids.slice().sort().join(',') : '';
                // Si mêmes ids et dernier appel il y a <15s, on saute
                if (hash === lastTripHashRef.current && (now - lastCallAtRef.current) < 15000) return;
                // purge ancienne data uniquement si on a des ids à demander
                if (!ids || ids.length === 0) {
                    setRtData({ isRealtime: false, fetchedAt: null, tripUpdatesCount: 0, tripUpdates: [] });
                } else {
                    setRtData(null);
                    const data = await realtimeUpdatesByTripIds(ids);
                    setRtData(data);
                }
                lastTripHashRef.current = hash;
                lastCallAtRef.current = Date.now();
            } catch (e) {
                console.error('[Map] realtime filtered fetch error', e);
                lastCallAtRef.current = Date.now();
            } finally {
                inFlightRtRef.current = false;
            }
        }
        // premier tick immédiat, puis toutes les 15s
        tick();
        rtTimerRef.current = window.setInterval(tick, 15000);
        return () => { if (rtTimerRef.current) window.clearInterval(rtTimerRef.current); };
    }, []);

    const selectedRealtimeTripUpdate = useMemo(() => {
        if (!selectedTripId || !rtData?.tripUpdates) return null;
        return rtData.tripUpdates.find((tu: any) => tu?.trip?.tripId === selectedTripId) || null;
    }, [selectedTripId, rtData]);

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
                {optionPrefs?.showRouteProgress && (
                    <StreamProgress total={streamInfo.total} received={streamInfo.received} elapsedMs={streamInfo.elapsedMs} loading={streamInfo.loading} />
                )}
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
                            onClick={() => handleRouteClick(routesCacheRef.current.get(id)?.route || route)}
                            highlighted={highlightedRouteId === id}
                        />
                    );
                })}

                {/* Vehicles */}
                {showAllVehicles && visibleRoutes.map((route: any) => {
                    const id = route.properties?.route_id || `${route.properties?.route_short_name}-${route.properties?.route_long_name}`;
                    const fullRoute = routesCacheRef.current.get(id)?.route || route;
                    const coords = fullRoute.geometry?.coordinates || [];
                    if (!coords || coords.length < 2) return null;
                    const positions = coords
                        .map((c: any) => {
                            const lon = Number(c[0]);
                            const lat = Number(c[1]);
                            if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
                            return null;
                        })
                        .filter(Boolean) as [number, number][];
                    const stops = fullRoute.properties?.stops || [];
                    let vehicleCount = 0;
                    let getStopTimesForVehicle: (idx: number) => any[] = () => [];
                    let coordsForVehicle: ((idx: number) => [number, number][]) | null = null;
                    let getTripIdForVehicle: ((idx: number) => string | undefined) | null = null;
                    if (stops[0]?.stop_times && Array.isArray(stops[0].stop_times)) {
                        vehicleCount = stops[0].stop_times.length;
                        getStopTimesForVehicle = (idx: number) => stops.map((s: any) => ({
                            stop_id: s.stop_id,
                            stop_lat: s.stop_lat,
                            stop_lon: s.stop_lon,
                            arrival_time: s.stop_times?.[idx]?.arrival_time,
                            departure_time: s.stop_times?.[idx]?.departure_time,
                            stop_sequence: s.stop_sequence,
                        }));
                        getTripIdForVehicle = () => undefined;
                    } else if (Array.isArray(fullRoute.properties?.trip_schedules)) {
                        const schedules = fullRoute.properties.trip_schedules as Array<{ trip_id: string; times: any[]; direction_id?: number }>;
                        vehicleCount = schedules.length;
                        const toTime = (sec: number | null) => {
                            if (sec == null || !isFinite(sec)) return undefined;
                            const h = Math.floor(sec / 3600);
                            const m = Math.floor((sec % 3600) / 60);
                            const s = Math.floor(sec % 60);
                            const pad = (n: number) => String(n).padStart(2, '0');
                            return `${pad(h)}:${pad(m)}:${pad(s)}`;
                        };
                        getStopTimesForVehicle = (idx: number) => {
                            const dir = Number(schedules[idx]?.direction_id) || 0;
                            if (dir === 1) {
                                return stops.map((_: any, i: number) => {
                                    const ri = stops.length - 1 - i;
                                    const s = stops[ri];
                                    const pair = schedules[idx]?.times?.[ri];
                                    return {
                                        stop_id: s.stop_id,
                                        stop_lat: s.stop_lat,
                                        stop_lon: s.stop_lon,
                                        arrival_time: Array.isArray(pair) ? toTime(pair[0] ?? null) : pair?.arrival_time,
                                        departure_time: Array.isArray(pair) ? toTime(pair[1] ?? null) : pair?.departure_time,
                                        stop_sequence: s.stop_sequence,
                                    };
                                });
                            }
                            return stops.map((s: any, stopIdx: number) => {
                                const pair = schedules[idx]?.times?.[stopIdx];
                                return {
                                    stop_id: s.stop_id,
                                    stop_lat: s.stop_lat,
                                    stop_lon: s.stop_lon,
                                    arrival_time: Array.isArray(pair) ? toTime(pair[0] ?? null) : pair?.arrival_time,
                                    departure_time: Array.isArray(pair) ? toTime(pair[1] ?? null) : pair?.departure_time,
                                    stop_sequence: s.stop_sequence,
                                };
                            });
                        };
                        coordsForVehicle = (idx: number) => (schedules[idx]?.direction_id === 1 ? [...positions].reverse() : positions);
                        getTripIdForVehicle = (idx: number) => schedules[idx]?.trip_id;
                    }
                    return Array.from({ length: vehicleCount }).map((_: unknown, idx: number) => {
                        const stopTimesForVehicle = getStopTimesForVehicle(idx);
                        const validStopTimesCount = stopTimesForVehicle.filter((st: any) => st.arrival_time || st.departure_time).length;
                        if (validStopTimesCount < 2) return null;
                        const coordsForThis = coordsForVehicle ? coordsForVehicle(idx) : positions;
                        const tripIdForThis = getTripIdForVehicle ? getTripIdForVehicle(idx) : undefined;
                        const realtimeUpdateForThisTrip = tripIdForThis && rtData?.tripUpdates ? rtData.tripUpdates.find((tu: any) => tu?.trip?.tripId === tripIdForThis) : null;
                        const realtimeStopTimeUpdates = realtimeUpdateForThisTrip?.stopTimeUpdates || null;
                        return (
                            <Vehicle
                                key={`veh-${id}-${idx}`}
                                vehicleKey={`veh-${id}-${idx}`}
                                routeId={id}
                                routeShortName={fullRoute.properties?.route_short_name}
                                coordinates={coordsForThis}
                                stopTimes={stopTimesForVehicle}
                                color={fullRoute.properties?.route_color || "#264653"}
                                isRunning={true}
                                onClick={() => handleVehicleClick(fullRoute, idx, tripIdForThis)}
                                zoomLevel={zoom}
                                realtimeStopTimeUpdates={realtimeStopTimeUpdates}
                                isHighlighted={
                                    !!selectedRoute &&
                                    (
                                        ((selectedRoute.properties?.route_id) || `${selectedRoute.properties?.route_short_name}-${selectedRoute.properties?.route_long_name}`) === id
                                    ) &&
                                    selectedTripIndex === idx
                                }
                            />
                        );
                    });
                })}

                {selectedRoute && (
                    <RouteInfoPanel
                        route={selectedRoute}
                        onClose={handleCloseRoutePanel}
                        selectedTripIndex={selectedTripIndex ?? undefined}
                        selectedTripId={selectedTripId ?? undefined}
                        realtimeTripUpdate={selectedRealtimeTripUpdate ?? undefined}
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
            {/* Overlay état realtime */}
            {rtData && optionPrefs?.showRealtimeOverlay && (
                <div style={{
                    position:'absolute',
                    top:16,
                    right:16,
                    background: rtData.isRealtime ? '#2a9d8f' : '#e76f51',
                    color:'#fff',
                    padding:'6px 10px',
                    borderRadius:4,
                    fontSize:12,
                    zIndex:120,
                    boxShadow:'0 2px 4px rgba(0,0,0,0.25)'
                }}>
                    <strong>Realtime</strong> {rtData.isRealtime ? 'LIVE' : (rtData.isStale ? 'STALE' : 'CACHE')} · {rtData.tripUpdatesCount ?? 0} updates · age {rtData.cacheAgeMs ? Math.round(rtData.cacheAgeMs/1000)+'s' : '0s'}{rtData.rateLimited ? ' · RL' : ''}
                </div>
            )}
        </div>
    );
};

export default MapView;

