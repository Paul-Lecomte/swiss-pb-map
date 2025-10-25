import React from "react";

interface Stop {
    stop_id: string;
    stop_name: string;
    arrival_time?: string;
    delay?: number;
}

interface Route {
    route_id: string;
    route_short_name: string;
    route_long_name?: string;
    properties: {
        stops: Stop[];
    };
}

interface RouteInfoPanelProps {
    route: Route | null;
    onClose: () => void;
}

const RouteInfoPanel: React.FC<RouteInfoPanelProps> = ({ route, onClose }) => {
    if (!route) return null;

    const stops = route.properties.stops || [];

    const getDelayClass = (delay: number) => {
        if (delay > 60) return "text-red-600";
        if (delay < -60) return "text-blue-600";
        return "text-green-700";
    };

    const formatDelay = (delay: number) => {
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
                <div className=" bg-red-700 p-2 text-white rounded-full flex items-center justify-center font-bold text-lg mr-3">
                    {route.properties.route_short_name}
                </div>
                <div className="flex-1">
                    <h3 className="text-[1.05em] font-semibold text-gray-800 leading-tight">
                        {route.properties.route_long_name}
                    </h3>
                    <p className="text-sm text-gray-500">{route.properties.route_id}</p>
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
                {/* Blue vertical line */}
                <div className="absolute left-[35%] sm:left-[25%] top-0 bottom-0 w-[2px] bg-blue-600 rounded-full z-0" />

                <ul className="list-none p-0 m-0 relative">
                    {stops.map((stop, i) => (
                        <li
                            key={stop.stop_id}
                            className="relative flex items-center my-4 z-10"
                        >
                            {/* Left info */}
                            <div className="flex gap-1 justify-end text-right text-[0.9em] w-[10%] sm:w-[20%] md:w-[12%] pr-2">
                                <span className={`font-semibold ${getDelayClass(stop.delay ?? 0)}`}>
                                  {formatDelay(stop.delay ?? 0)}
                                </span>
                                <span className="text-gray-600">{stop.arrival_time || "00:00"}</span>
                            </div>

                            {/* Center dot */}
                            <div
                                className="absolute bg-white border-2 border-blue-600 rounded-full w-[10px] h-[10px] z-10"
                                style={{
                                    left: "21%",
                                    transform: "translateX(-50%)",
                                }}
                            ></div>

                            {/* Stop name */}
                            <div className="flex-1 ml-13">
                                <span className="text-gray-900 text-[0.95em]">{stop.stop_name}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default RouteInfoPanel;