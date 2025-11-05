import React from "react";
import { Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "./markerStyles.css";

interface StopPopupProps {
    stop: any;
}

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

    const routeDesc = stop.properties.routes[0].route_desc;

    const getStopIcon = (desc: string) => {
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
        return createLeafletIcon(busIcon); // fallback
    };

    const getRouteColor = (route: string) => {
        if (route.startsWith('S')) return '#0078D7';
        if (route.startsWith('IC') || route.startsWith('IR')) return '#E63946';
        if (route.startsWith('RE')) return '#F4A261';
        if (route.startsWith('T')) return '#2A9D8F';
        if (route.startsWith('B')) return '#264653';
        return '#777';
    };

    const lat = Number(stop.stop_lat ?? stop.geometry?.coordinates[1]);
    const lon = Number(stop.stop_lon ?? stop.geometry?.coordinates[0]);
    const name = stop.stop_name ?? stop.properties?.stop_name;
    const routes = stop.properties.routes;

    return (
        <Marker position={[lat, lon]} icon={getStopIcon(routeDesc) as any}>
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
                        {routes.map((r: any, i: number) => (
                            <span
                                key={`${r.route_short_name}-${i}`}
                                className="route-badge"
                                style={{ backgroundColor: getRouteColor(r.route_short_name) }}
                            >
                                {r.route_short_name}
                            </span>
                        ))}
                    </div>
                </div>
            </Popup>
        </Marker>
    );
};

export default StopMarker;