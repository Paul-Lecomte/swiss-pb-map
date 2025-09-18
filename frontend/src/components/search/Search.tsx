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
                background: "rgba(255,255,255,0.85)",
                borderRadius: 24,
                boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                padding: "4px 12px",
                minWidth: 340,
                maxWidth: 600,
                width: "100%",
                border: "1px solid rgba(0,0,0,0.08)",
                gap: 8,
            }}
        >
            {/* Hamburger button */}
            <button
                onClick={onHamburger}
                aria-label="Menu"
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "none",
                    background: "transparent",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                }}
            >
                <div style={{ width: 20 }}>
                    <div style={{ height: 3, background: "#333", margin: "4px 0", borderRadius: 2 }} />
                    <div style={{ height: 3, background: "#333", margin: "4px 0", borderRadius: 2 }} />
                    <div style={{ height: 3, background: "#333", margin: "4px 0", borderRadius: 2 }} />
                </div>
            </button>

            {/* Search field */}
            <input
                placeholder="Rechercher un lieu, une adresse..."
                style={{
                    flex: 1,
                    height: 36,
                    border: "none",
                    outline: "none",
                    padding: "0 10px",
                    borderRadius: 18,
                    fontSize: 15,
                    background: "transparent",
                }}
            />

            {/* Magnifier icon */}
            <div style={{ width: 36, display: "grid", placeItems: "center", color: "#333" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </div>

            {/* Avatar/Profile button */}
            <button
                aria-label="Profil"
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    border: "none",
                    background: "#eee",
                    display: "grid",
                    placeItems: "center",
                    marginLeft: 4,
                    cursor: "pointer",
                }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4"></circle>
                    <path d="M6 20c0-2.2 3.6-4 6-4s6 1.8 6 4"></path>
                </svg>
            </button>
        </div>
    );
}