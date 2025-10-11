import React from "react";
import { Polyline, CircleMarker } from "react-leaflet";

interface RouteLineProps {
    route: any;
    color?: string;
    onClick?: () => void;
    highlighted?: boolean;
}

const RouteLine: React.FC<RouteLineProps> = ({ route, color = "#0074D9", onClick, highlighted }) => {
    const positions = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
    const routeColor = route.route_color || color;
    const stops = route.properties?.stops || [];

    return (
        <>
            <Polyline
                positions={positions}
                pathOptions={{
                    color: routeColor,
                    weight: 1,
                    opacity: 0.80,
                    lineCap: "round",
                }}
                eventHandlers={{
                    click: () => { if (onClick) onClick(); }
                }}
            />
            {highlighted && stops.map((stop: any, idx: number) => (
                <CircleMarker
                    key={idx}
                    center={[stop.stop_lat, stop.stop_lon]}
                    radius={4}
                    pathOptions={{
                        color: routeColor,
                        fillColor: routeColor,
                        fillOpacity: 0.9,
                        weight: 1,
                    }}
                />
            ))}
        </>
    );
};

export default RouteLine;