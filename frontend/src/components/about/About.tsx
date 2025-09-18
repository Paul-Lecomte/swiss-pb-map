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
            <div style={{ fontSize: 12 }}>
                Info about the application here.
            </div>
        </div>
    );
}