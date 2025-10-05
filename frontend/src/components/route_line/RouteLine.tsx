// TODO: add popup with stops and more info on the route
import React from "react";
import { Polyline } from "react-leaflet";

interface RouteLineProps {
    route: any;
    color?: string;
}

const RouteLine: React.FC<RouteLineProps> = ({ route, color = "#0074D9" }) => {
    const positions = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
    const routeColor = route.route_color || color;

    return (
        <Polyline
            positions={positions}
            pathOptions={{
                color: routeColor,
                weight: 4, // plus fin
                opacity: 0.92,
                lineCap: "round",
            }}
        />
    );
};

export default RouteLine;