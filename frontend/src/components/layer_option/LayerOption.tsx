"use client";

import React from "react";

type Props = { onClose?: () => void };

type LayerKeys = "railway" | "stations" | "tram" | "bus" | "trolleybus" | "ferry" | "backgroundPois";

type LayerState = Record<LayerKeys, boolean>;

const labelToKey: Record<string, LayerKeys> = {
  "Railway lines": "railway",
  "Stations": "stations",
  "Tram": "tram",
  "Bus": "bus",
  "Trolleybus": "trolleybus",
  "Ferry": "ferry",
  "Background POIs": "backgroundPois",
};

export default function LayerOption({ onClose }: Props) {
  const [state, setState] = React.useState<LayerState>({
    railway: true,
    stations: true,
    tram: true,
    bus: true,
    trolleybus: true,
    ferry: true,
    backgroundPois: true,
  });

  const toggle = (key: LayerKeys) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.checked;
    setState((prev) => ({ ...prev, [key]: value }));
    // Notify the app so the map can react
    try {
      window.dispatchEvent(
        new CustomEvent("app:layer-visibility", { detail: { key, value } })
      );
    } catch {}
  };

  const labels = [
    "Railway lines",
    "Stations",
    "Tram",
    "Bus",
    "Trolleybus",
    "Ferry",
    "Background POIs",
  ];

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
        {labels.map((label) => {
          const key = labelToKey[label];
          return (
            <label key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={state[key]}
                onChange={toggle(key)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
