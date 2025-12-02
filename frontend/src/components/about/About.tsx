"use client";

import React from "react";

type Props = { onClose?: () => void };

export default function About({ onClose }: Props) {
    return (
        <div
            style={{
                width: 220,
                background: "#fff",
                border: "1px solid rgba(0,0,0,0.15)",
                borderRadius: 10,
                boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
                padding: 12,
                color: "#222",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 12 }}>About</strong>
                <button onClick={onClose} aria-label="Fermer" style={{ background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.35 }}>
                <div style={{ marginBottom: 6 }}>
                    <strong>Swiss Public Transport Map</strong> visualizes public transport in Switzerland on an interactive map. 
                    Explore routes, live vehicle positions, and basic route details in real time.
                </div>
                <div style={{ marginBottom: 6 }}>
                    Built with a React + TypeScript frontend and a lightweight Node.js backend. 
                    The app streams updates to the UI for a smooth, near real-time experience.
                </div>
                <div>
                    Data sources: SBB CFF FFS static GTFS (timetables) and GTFS-Realtime feeds (vehicle positions, delays),
                    provided via opentransportdata.swiss. This project is independent and not affiliated with SBB.
                </div>
            </div>
        </div>
    );
}