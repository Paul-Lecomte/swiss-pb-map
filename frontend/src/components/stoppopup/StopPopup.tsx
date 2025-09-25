import React from "react";
import { useMap } from "react-leaflet";
import "./popupStyles.css";

interface StopPopupProps {
    name: string;
    routes: { route_short_name: string }[];
    getRouteColor: (route: string) => string;
}

const StopPopup: React.FC<StopPopupProps> = ({ name, routes, getRouteColor }) => {
    const map = useMap(); // hook to access Leaflet map instance

    return (
        <div className="custom-popup">
            <button
                className="popup-close-btn"
                onClick={() => {
                    map.closePopup(); // closes the currently open popup
                }}
            >
                ×
            </button>
            <div className="popup-title">{name}</div>
            <div className="popup-routes">
                {routes.map((r, i) => (
                    <span
                        key={`${r.route_short_name}-${i}`}
                        className="route-badge"
                        style={{ backgroundColor: getRouteColor(r.route_short_name) }}
                    >
                        {r.route_short_name}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default StopPopup;