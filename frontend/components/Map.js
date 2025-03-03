"use client";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const Map = () => {
    return (
        <MapContainer center={[46.5197, 6.6323]} zoom={12} className="w-full h-[500px]">
            {/* OpenStreetMap Tiles */}
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {/* Example Marker */}
            <Marker position={[46.5197, 6.6323]}>
                <Popup>Lausanne City Center</Popup>
            </Marker>
        </MapContainer>
    );
};

export default Map;