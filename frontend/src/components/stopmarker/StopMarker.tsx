import React from "react";
import { Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "./markerStyles.css";

interface RouteInfo { route_short_name?: string; route_id?: string; route_desc?: string; stop_name?: string; }
interface StopFeature { stop_lat?: number; stop_lon?: number; stop_name?: string; properties?: { stop_name?: string; routes?: RouteInfo[] }; geometry?: { coordinates?: [number, number] }; }
interface StopPopupProps { stop: StopFeature; }

const busIcon = '/icons/bus_marker.png';
const metroIcon = '/icons/metro_marker.png';
const trainIcon = '/icons/train_marker.png';
const tramIcon = '/icons/tram_marker.png';
const ferryIcon = '/icons/ferry_marker.png';
const cableIcon = '/icons/cable_marker.png';

const createLeafletIcon = (iconUrl: string) =>
    new L.Icon({
        iconUrl,
        iconSize: [20, 20],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
    });

const StopMarker: React.FC<StopPopupProps> = ({ stop }) => {
    const map = useMap();

    // Ensure we have a routes array; if not, skip rendering this marker
    if (!Array.isArray(stop?.properties?.routes)) {
        console.debug('[StopMarker] No routes array for stop', stop?.stop_name || stop?.properties?.stop_name || stop);
        // Early return: insufficient data to render a meaningful marker
        return null;
    }
    // Normalize routes (remove falsy entries)
    const routes: RouteInfo[] = stop.properties.routes.filter((r: RouteInfo | undefined): r is RouteInfo => !!r);
    // Pick a primary route with a usable descriptor for icon selection
    const primaryRoute = routes.find(r => r && (r.route_desc || r.route_short_name)) || routes[0];
    const routeDesc: string = primaryRoute?.route_desc || primaryRoute?.route_short_name || 'Bus';

    const getStopIcon = (desc: string) => {
        // Map route descriptor to icon category sets
        const trainTypes = new Set([
            'S', 'SN', 'R','TGV',
            'IC', 'IC1', 'IC2', 'IC3', 'IC5', 'IC6', 'IC8', 'IC21',
            'IR', 'IR13', 'IR15', 'IR16', 'IR17', 'IR26', 'IR27', 'IR35', 'IR36', 'IR37', 'IR46', 'IR57', 'IR65', 'IR66', 'IR70',
            'RE', 'RE33', 'RE37', 'RE48',
            'S40', 'S41', 'EXT',
            'EC', 'ICE', 'TGV Lyria', 'Thalys'
        ]);
        const tramTypes = new Set(['Tram', 'T1','T2','T3','T4','T5','T6','T7','T8']);
        const metroTypes = new Set(['M']);
        const busTypes = new Set(['Bus','B1','B2','B3','B4','B5','B6','B7','B8']);
        const ferryTypes = new Set(['Ferry','F1','F2','F3','3100','N1','N2','3150','BAT']);
        const cableTypes = new Set(['Cable Car','Funicular','Gondola']);

        if (trainTypes.has(desc)) return createLeafletIcon(trainIcon);
        if (tramTypes.has(desc)) return createLeafletIcon(tramIcon);
        if (busTypes.has(desc)) return createLeafletIcon(busIcon);
        if (ferryTypes.has(desc)) return createLeafletIcon(ferryIcon);
        if (cableTypes.has(desc)) return createLeafletIcon(cableIcon);
        if (metroTypes.has(desc)) return createLeafletIcon(metroIcon);
        return createLeafletIcon(busIcon); // Default fallback icon
    };

    const getRouteColor = (route: string) => {
        // Simple heuristic for color coding by route prefix
        if (!route) return '#777';
        if (route.startsWith('S')) return '#0078D7';
        if (route.startsWith('IC') || route.startsWith('IR')) return '#E63946';
        if (route.startsWith('RE')) return '#F4A261';
        if (route.startsWith('T')) return '#2A9D8F';
        if (route.startsWith('B')) return '#264653';
        return '#777';
    };

    // Derive coordinates; skip marker if invalid
    const latRaw = stop.stop_lat ?? stop.geometry?.coordinates?.[1];
    const lonRaw = stop.stop_lon ?? stop.geometry?.coordinates?.[0];
    const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
    const lon = typeof lonRaw === 'number' ? lonRaw : Number(lonRaw);
    if (!isFinite(lat) || !isFinite(lon)) return null; // Invalid coordinate data

    // Prefer explicit stop name; fallback to properties or primary route
    const name = stop.stop_name ?? stop.properties?.stop_name ?? primaryRoute?.stop_name ?? 'Unknown stop';

    return (
        <Marker position={[lat, lon]} icon={getStopIcon(routeDesc)}>
            <Popup>
                <div className="custom-popup">
                    <button
                        className="popup-close-btn"
                        onClick={() => map.closePopup()}
                    >
                        ×
                    </button>
                    <div className="popup-title">{name}</div>
                    <div className="popup-routes">
                        {routes.length === 0 && (
                            <span className="route-badge" style={{ backgroundColor: '#777' }}>No routes</span>
                        )}
                        {routes.map((r: RouteInfo, i: number) => {
                            const short = r?.route_short_name || r?.route_id || '?';
                            return (
                                <span
                                    key={`${short}-${i}`}
                                    className="route-badge"
                                    style={{ backgroundColor: getRouteColor(String(short)) }}
                                >
                                    {short}
                                </span>
                            );
                        })}
                    </div>
                </div>
            </Popup>
        </Marker>
    );
};

export default StopMarker;

