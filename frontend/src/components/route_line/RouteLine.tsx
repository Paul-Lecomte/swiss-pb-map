import React from "react";
import { Polyline, useMap } from "react-leaflet";

interface RouteLineProps {
    route: any;
    color?: string;
    onClick?: () => void;
}

const RouteLine: React.FC<RouteLineProps> = ({ route, color = "#0074D9", onClick }) => {
    const positions = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
    const routeColor = route.route_color || color;

    return (
        <Polyline
            positions={positions}
            pathOptions={{
                color: routeColor,
                weight: 4,
                opacity: 0.92,
                lineCap: "round",
            }}
            eventHandlers={{
                click: () => { if (onClick) onClick(); }
            }}
        />
    );
};

export default RouteLine;