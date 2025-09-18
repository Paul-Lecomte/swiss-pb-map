// frontend/src/components/map/Map.tsx
"use client";

import React from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import ZoomControl from "../zoom/ZoomControl"; // ⚡ ton contrôle custom
import "leaflet/dist/leaflet.css";

const Map = () => (
    <div
        style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 0,
        }}
    >
        <MapContainer
            center={[46.516, 6.63282]}
            zoom={13}
            style={{ position: "relative", width: "100%", height: "100%" }}
        >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ZoomControl /> {/* ✅ apparaît comme un vrai contrôle */}
        </MapContainer>
    </div>
);

export default Map;