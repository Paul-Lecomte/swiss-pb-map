import React, { useState, useEffect } from "react";
import { searchProcessedStops } from "../../services/StopsApiCalls";
import "./Search.css";

type Stop = {
    stop_id: string;
    stop_name: string;
    location_type?: string;
    stop_lat?: number;
    stop_lon?: number;
};

type Props = {
    onHamburger?: () => void;
    onStopSelect?: (stop: Stop) => void;
};

const typeIcons: Record<string, string> = {
    train: "🚆",
    bus: "🚌",
    metro: "🚇",
    boat: "⛴️",
};

export default function Search({ onHamburger, onStopSelect }: Props) {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<Stop[]>([]);
    const [type, setType] = useState<string>("");

    useEffect(() => {
        if (query.length === 0) {
            setSuggestions([]);
            return;
        }
        let cancelled = false;
        searchProcessedStops(query, type)
            .then(data => {
                if (!cancelled) setSuggestions(data);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [query, type]);

    const handleSelect = (stop: Stop) => {
        console.log("Suggestion cliquée :", stop); // Ajout du log
        setQuery("");
        setSuggestions([]);
        if (onStopSelect) onStopSelect(stop);
        try {
            window.dispatchEvent(new CustomEvent("app:stop-select", { detail: stop }));
        } catch {}
    };

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
                placeholder="search for a station"
                className="search-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoComplete="off"
            />
            <select
                className="search-type-select"
                value={type}
                onChange={e => setType(e.target.value)}
            >
                <option value="">Tous</option>
                <option value="train">Train</option>
                <option value="bus">Bus</option>
                <option value="metro">Métro</option>
                <option value="boat">Bateau</option>
            </select>
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
            {suggestions.length > 0 && (
                <ul className="search-suggestions">
                    {suggestions.map(stop => (
                        <li
                            key={stop.stop_id}
                            className="search-suggestion-item"
                            onClick={() => handleSelect(stop)}
                        >
                            <span className="suggestion-icon">
                                {typeIcons[stop.location_type ?? ""] ?? "📍"}
                            </span>
                            <span className="suggestion-name">{stop.stop_name}</span>
                            {stop.location_type && (
                                <span className="suggestion-type">{stop.location_type}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}