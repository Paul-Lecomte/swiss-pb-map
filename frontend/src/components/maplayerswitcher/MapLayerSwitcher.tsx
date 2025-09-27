import React, { useState } from "react";

interface MapLayerSwitcherProps {
    selectedLayer: string;
    onChange: (layer: string) => void;
}

const layers = [
    {
        name: "Light",
        url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attribution: "&copy; CARTO & OSM",
        thumbnail: "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/6/32/21.png",
        maxZoom: 17, // Carto basemaps support up to 20
    },
    {
        name: "Dark",
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: "&copy; CARTO & OSM",
        thumbnail: "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/6/32/21.png",
        maxZoom: 17,
    },
    {
        name: "Streets",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "&copy; OSM",
        thumbnail: "https://tile.openstreetmap.org/6/32/21.png",
        maxZoom: 17, // OSM standard supports up to 19
    },
    {
        name: "Satellite",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution: "© ESRI",
        thumbnail: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/21/32",
        maxZoom: 17, // ESRI World Imagery supports up to 17
    },
];

const MapLayerSwitcher: React.FC<MapLayerSwitcherProps> = ({ selectedLayer, onChange }) => {
    const [open, setOpen] = useState(false);

    const selected = layers.find(l => l.name === selectedLayer) || layers[0];

    return (
        <div
            style={{
                position: "absolute",
                bottom: 10,
                left: 10,
                zIndex: 1000,
                background: "white",
                padding: "6px",
                borderRadius: "8px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
            }}
        >
            {/* Collapsed button */}
            {!open && (
                <div
                    onClick={() => setOpen(true)}
                    style={{
                        width: "70px",
                        height: "70px",
                        borderRadius: "6px",
                        overflow: "hidden",
                        cursor: "pointer",
                        border: "1px solid #ccc",
                        position: "relative"
                    }}
                >
                    <img
                        src={selected.thumbnail}
                        alt={selected.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: "rgba(0,0,0,0.6)",
                            color: "white",
                            fontSize: "12px",
                            textAlign: "center",
                            padding: "2px"
                        }}
                    >
                        {selected.name}
                    </div>
                </div>
            )}

            {/* Expanded menu */}
            {open && (
                <div style={{ display: "flex", gap: "8px" }}>
                    {layers.map((layer) => (
                        <div
                            key={layer.name}
                            onClick={() => {
                                onChange(layer.name);
                                setOpen(false); // close after selecting
                            }}
                            style={{
                                width: "70px",
                                height: "70px",
                                borderRadius: "6px",
                                overflow: "hidden",
                                cursor: "pointer",
                                border: layer.name === selectedLayer ? "3px solid #0078D7" : "1px solid #ccc",
                                position: "relative"
                            }}
                        >
                            <img
                                src={layer.thumbnail}
                                alt={layer.name}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                            <div
                                style={{
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: "rgba(0,0,0,0.6)",
                                    color: "white",
                                    fontSize: "12px",
                                    textAlign: "center",
                                    padding: "2px"
                                }}
                            >
                                {layer.name}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export { layers };
export default MapLayerSwitcher;