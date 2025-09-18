"use client";

import React from "react";

type Props = {
  onClose?: () => void;
  onLayerOption?: () => void;
};

export default function SideMenu({ onClose, onLayerOption }: Props) {
  return (
    <div
      style={{
        width: 160,
        background: "#fff",
        border: "1px solid rgba(0,0,0,0.15)",
        borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
        padding: 10,
        color: "#222",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Menu</strong>
        <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
        <li>
          <button onClick={onLayerOption} style={itemBtn}>Layer option</button>
        </li>
        <li>
          <button style={itemBtn}>Stations</button>
        </li>
        <li>
          <button style={itemBtn}>Options</button>
        </li>
        <li>
          <button style={itemBtn}>About</button>
        </li>
      </ul>
    </div>
  );
}

const itemBtn: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  padding: "8px 6px",
  borderRadius: 6,
  cursor: "pointer",
};
