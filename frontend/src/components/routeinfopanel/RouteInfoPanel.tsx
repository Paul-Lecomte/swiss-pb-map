import React, { useEffect } from "react";

interface StopTime {
    arrival_time?: string;
    departure_time?: string;
    delay?: number;
    stop_sequence?: number;
}

interface Stop {
    stop_id: string;
    stop_name: string;
    stop_times?: StopTime[];
}

interface Route {
    route_id: string;
    properties: {
        stops: Stop[];
        route_short_name: string;
        route_long_name?: string;
        trip_headsign: string;
    };
}

interface RouteInfoPanelProps {
    route: Route | null;
    onClose: () => void;
}

const RouteInfoPanel: React.FC<RouteInfoPanelProps> = ({ route, onClose }) => {
    useEffect(() => {
        if (route) {
            console.log("[RouteInfoPanel] route data:", route);
            console.log("[RouteInfoPanel] stops:", route.properties.stops);
        }
    }, [route]);

    if (!route) return null;

    const stops = route.properties.stops || [];

    const delayColors = {
        late2: "text-red-600",
        late1: "text-orange-500",
        onTime: "text-green-700",
        early2: "text-blue-600",
        early1: "text-cyan-500",
        missing: "text-grey-400",
    };

    const getDelayClass = (delay?: number) => {
        if (delay === undefined || delay === null) return delayColors.missing;
        if (delay > 120) return delayColors.late2;
        if (delay > 60) return delayColors.late1;
        if (delay < -120) return delayColors.early2;
        if (delay < -60) return delayColors.early1;
        return delayColors.onTime;
    };

    const formatDelay = (delay?: number) => {
        if (delay === undefined || delay === null) return "+0s";
        if (delay === 0) return "+0";
        const sign = delay > 0 ? "+" : "-";
        const minutes = Math.floor(Math.abs(delay) / 60);
        return `${sign}${minutes}m`;
    };

    return (
        <div className="absolute top-[85px] left-4 w-[30%] max-w-[400px] h-[80vh] bg-white rounded-lg shadow-lg font-[Segoe_UI] overflow-y-auto p-4 z-[9999] transition-all duration-300
                        md:w-[40%] sm:w-[90%] sm:left-[5%] sm:top-[70px] sm:h-[70vh]">
            {/* HEADER */}
            <div className="flex items-center mb-3 relative">
                <div className="bg-red-700 p-2 text-white rounded-full flex items-center justify-center font-bold text-lg mr-3">
                    {route.properties.route_short_name}
                </div>
                <div className="flex-1">
                    <h3 className="text-[1.05em] font-semibold text-gray-800 leading-tight">
                        {route.properties.trip_headsign || "N/A"}
                    </h3>
                    <p className="text-sm text-gray-500">{route.route_id}</p>
                </div>
                <button
                    onClick={onClose}
                    className="absolute right-0 top-0 text-gray-500 hover:text-black text-xl"
                >
                    ✖
                </button>
            </div>

            {/* TIMELINE */}
            <div className="relative mt-4 pl-6 pr-4">
                <div className="absolute left-[35%] sm:left-[25%] top-0 bottom-0 w-[2px] bg-blue-600 rounded-full z-0" />

                <ul className="list-none p-0 m-0 relative">
                    {stops.map((stop, i) => {
                        const stopTime = stop.stop_times?.[0];
                        const key = stopTime
                            ? `${stop.stop_id}-${stopTime.stop_sequence}`
                            : `${stop.stop_id}-${i}`;

                        return (
                            <li key={key} className="relative flex items-center my-4 z-10">
                                {/* Left info */}
                                <div className="flex flex-col items-end text-[0.9em] w-[12%] pr-2">
                                    {stopTime && (
                                        <>
                                            <span className={`font-semibold ${getDelayClass(stopTime.delay)}`}>
                                                {formatDelay(stopTime.delay)}
                                            </span>
                                            <span className="text-gray-600">{stopTime.arrival_time || "00:00"}</span>
                                            <span className="text-gray-400 text-[0.75em]">{stopTime.departure_time || ""}</span>
                                        </>
                                    )}
                                </div>

                                {/* Center dot */}
                                <div
                                    className="absolute bg-white border-2 border-blue-600 rounded-full w-[10px] h-[10px] z-10"
                                    style={{ left: "21%", transform: "translateX(-50%)" }}
                                />

                                {/* Stop name */}
                                <div className="flex-1 ml-13">
                                    <span className="text-gray-900 text-[0.95em]">{stop.stop_name}</span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};

export default RouteInfoPanel;