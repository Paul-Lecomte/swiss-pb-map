import React from "react";
import { Polyline, CircleMarker } from "react-leaflet";

interface RouteLineProps {
    route: any;
    color?: string;
    onClick?: () => void;
    highlighted?: boolean;
}

const RouteLine: React.FC<RouteLineProps> = ({ route, color = "#0074D9", onClick, highlighted }) => {
    if (!route?.geometry?.coordinates || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length === 0) {
        return null;
    }

    // Ensure coordinates are valid [lat, lon] pairs
    const positions = route.geometry.coordinates
        .map((coord: any) => {
            const lon = Number(coord[0]);
            const lat = Number(coord[1]);
            if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
            return null;
        })
        .filter(Boolean) as [number, number][];

    const routeColor = route.properties?.route_color || color;
    const stops = route.properties?.stops || [];

    return (
        <>
            <Polyline
                positions={positions}
                pathOptions={{
                    color: routeColor,
                    weight: 1.5,
                    opacity: 0.8,
                    lineCap: "round",
                }}
                eventHandlers={{
                    click: () => { if (onClick) onClick(); }
                }}
            />
            {highlighted && stops.map((stop: any, idx: number) => (
                <CircleMarker
                    key={idx}
                    center={[Number(stop.stop_lat), Number(stop.stop_lon)] as [number, number]}
                    pathOptions={{
                        color: routeColor,
                        fillColor: routeColor,
                        fillOpacity: 0.9,
                        weight: 1,
                    }}
                    {...({ radius: 4 } as any)}
                />
            ))}
        </>
    );
};

export default RouteLine;