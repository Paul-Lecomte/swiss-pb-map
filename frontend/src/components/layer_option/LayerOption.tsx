"use client";

import React from "react";

type Props = { onClose?: () => void };

export default function LayerOption({ onClose }: Props) {
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
        <strong style={{ fontSize: 12 }}>Layer option</strong>
        <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ fontSize: 12, display: "grid", gap: 6 }}>
        {[
          "Railway lines",
          "Stations",
          "Tram",
          "Bus",
          "Trolleybus",
          "Ferry",
          "Background POIs",
        ].map((label) => (
          <label key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" defaultChecked />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
