import React from "react";
import { Polyline } from "react-leaflet";

interface RouteLineProps {
    route: any;
    color?: string;
}

const RouteLine: React.FC<RouteLineProps> = ({ route, color = "#0074D9" }) => {
    const positions = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
    return <Polyline positions={positions} color={color} />;
};

export default RouteLine;
