"use client";

import React from "react";

type Props = {
  onHamburger?: () => void;
};

export default function Search({ onHamburger }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* Hamburger button */}
      <button
        onClick={onHamburger}
        aria-label="Open menu"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          border: "1px solid rgba(0,0,0,0.15)",
          background: "#fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
      >
        <div style={{ width: 16 }}>
          <div style={{ height: 2, background: "#333", margin: "3px 0", borderRadius: 1 }} />
          <div style={{ height: 2, background: "#333", margin: "3px 0", borderRadius: 1 }} />
          <div style={{ height: 2, background: "#333", margin: "3px 0", borderRadius: 1 }} />
        </div>
      </button>

      {/* Search field */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          background: "#fff",
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 10,
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          height: 36,
          minWidth: 280,
        }}
      >
        <input
          placeholder="Search something"
          style={{
            flex: 1,
            height: "100%",
            border: "none",
            outline: "none",
            padding: "0 10px",
            borderRadius: 10,
            fontSize: 14,
            background: "transparent",
          }}
        />
        <div style={{ width: 36, display: "grid", placeItems: "center", color: "#333" }}>
          {/* magnifier */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
      </div>
    </div>
  );
}
