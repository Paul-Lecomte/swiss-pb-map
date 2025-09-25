import React from "react";

interface MapLayerSwitcherProps {
    selectedLayer: string;
    onChange: (layer: string) => void;
}

const layers = [
    { name: "Light", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: '&copy; CARTO & OSM' },
    { name: "Dark", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: '&copy; CARTO & OSM' },
    { name: "Streets", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; OSM' },
    { name: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: '© ESRI' },
];

const MapLayerSwitcher: React.FC<MapLayerSwitcherProps> = ({ selectedLayer, onChange }) => {
    return (
        <div style={{ position: "absolute", bottom: 10, left: 10, zIndex: 1000, background: "white", padding: "6px", borderRadius: "4px" }}>
            {layers.map((layer) => (
                <button
                    key={layer.name}
                    onClick={() => onChange(layer.name)}
                    style={{
                        margin: 2,
                        padding: "4px 8px",
                        background: layer.name === selectedLayer ? "#0078D7" : "#eee",
                        color: layer.name === selectedLayer ? "#fff" : "#000",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer"
                    }}
                >
                    {layer.name}
                </button>
            ))}
        </div>
    );
};

export { layers };
export default MapLayerSwitcher;