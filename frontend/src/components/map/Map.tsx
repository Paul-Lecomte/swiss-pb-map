"use client";

import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import ZoomControl from "../zoom/ZoomControl";
import "leaflet/dist/leaflet.css";
import { fetchProcessedStops } from "../../services/StopsApiCalls";

const Map = () => {
    const [stops, setStops] = useState([]);

    useEffect(() => {
        const getStops = async () => {
            try {
                const data = await fetchProcessedStops();
                setStops(data);
            } catch (error) {
                console.error("Erreur lors du fetch des arrêts:", error);
            }
        };
        getStops();
    }, []);

    return (
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
                {/* Custom stop marker here */}
            </MapContainer>
        </div>
    );
};

export default Map;