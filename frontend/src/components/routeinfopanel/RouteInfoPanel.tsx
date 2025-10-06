import React from "react";

interface RouteInfoPanelProps {
    route: any;
    onClose: () => void;
}

const RouteInfoPanel: React.FC<RouteInfoPanelProps> = ({ route, onClose }) => {
    if (!route) return null;

    const stops = route.properties.stops || [];

    console.log("Rendering RouteInfoPanel for route:", route);

    return (
        <div
            style={{
                position: "absolute",
                top: 85,
                left: 16,
                width: "320px",
                height: "80vh",
                backgroundColor: "white",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                overflowY: "auto",
                zIndex: 9999,
                padding: "12px",
            }}
        >
            <button onClick={onClose} style={{ float: "right", cursor: "pointer" }}>
                ✖
            </button>
            <h3 style={{ marginTop: 0 }}>{route.route_long_name || route.route_short_name}</h3>
            <p><strong>Route ID:</strong> {route.route_id}</p>

            <ul style={{ paddingLeft: "1rem", listStyle: "none" }}>
                {stops.map((stop: any, i: number) => (
                    <li key={stop.stop_id} style={{ marginBottom: "6px" }}>
                        <span style={{ color: "#0074D9" }}>●</span> {stop.stop_name}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default RouteInfoPanel;