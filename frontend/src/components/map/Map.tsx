"use client";

import React from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import ZoomControl from "../zoom/ZoomControl";
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
            zoomControl={false}
            style={{ position: "relative", width: "100%", height: "100%" }}
        >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ZoomControl />
        </MapContainer>
    </div>
);

export default Map;