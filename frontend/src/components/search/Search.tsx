import React from "react";
import "./Search.css";

type Props = {
    onHamburger?: () => void;
};

export default function Search({ onHamburger }: Props) {
    return (
        <div className="search-bar">
            <button
                onClick={onHamburger}
                aria-label="Menu"
                className="search-hamburger"
            >
                <div className="search-hamburger-icon">
                    <div />
                    <div />
                    <div />
                </div>
            </button>
            <input
                placeholder="Search for a station or line"
                className="search-input"
            />
            <div className="search-magnifier">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </div>
            <button aria-label="Profil" className="search-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4"></circle>
                    <path d="M6 20c0-2.2 3.6-4 6-4s6 1.8 6 4"></path>
                </svg>
            </button>
        </div>
    );
}