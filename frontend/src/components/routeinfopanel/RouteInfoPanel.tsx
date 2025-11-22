import React, { useEffect, useMemo } from "react";

interface StopTime {
    arrival_time?: string;
    departure_time?: string;
    delay?: number;
    stop_sequence?: number;
}

interface Stop {
    stop_id: string;
    stop_name: string;
    stop_lat?: number;
    stop_lon?: number;
    stop_times?: StopTime[];
    stop_sequence?: number;
}

interface RoutePropsShape {
    stops: Stop[];
    route_id?: string;
    route_short_name: string;
    route_long_name?: string;
    trip_headsign: string;
    trip_schedules?: Array<{ trip_id: string; times: any[]; direction_id?: number }>; // optional compact format
}

interface Route {
    route_id?: string;
    properties: RoutePropsShape;
}

interface RealtimeTripUpdate {
    trip?: { tripId?: string };
    stopTimeUpdates?: Array<{ stopId: string; stopSequence: number; arrivalDelaySecs: number | null; departureDelaySecs: number | null; arrivalTimeSecs: number | null; departureTimeSecs: number | null }>;
}

interface RouteInfoPanelProps {
    route: Route | null;
    onClose: () => void;
    selectedTripIndex?: number;
    selectedTripId?: string;
    realtimeTripUpdate?: RealtimeTripUpdate; // nouvel objet temps réel pour le trip sélectionné
}

const RouteInfoPanel: React.FC<RouteInfoPanelProps> = ({ route, onClose, selectedTripIndex, selectedTripId, realtimeTripUpdate }) => {
    const routeId = route?.route_id || route?.properties?.route_id || "";

    // Ensure stops have stop_times: rebuild from trip_schedules if necessary (en gérant la direction)
    const normalizedStops = useMemo(() => {
        if (!route?.properties?.stops) return [] as Stop[];
        const stops = route.properties.stops.map(s => ({ ...s }));
        const schedules = route.properties.trip_schedules;
        const hasStopTimes = stops.some(s => Array.isArray(s.stop_times) && s.stop_times.length > 0);
        if (schedules && schedules.length && !hasStopTimes) {
            const byStop: StopTime[][] = stops.map(() => []);
            const toTime = (sec: number | null) => {
                if (sec == null || !isFinite(sec)) return undefined;
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${pad(h)}:${pad(m)}:${pad(s)}`;
            };
            const N = stops.length;
            for (let v = 0; v < schedules.length; v++) {
                const times = schedules[v].times || [];
                const dir = Number(schedules[v]?.direction_id) || 0;
                for (let i = 0; i < N; i++) {
                    const idx = dir === 1 ? (N - 1 - i) : i;
                    const s = stops[idx];
                    const pair = times[idx];
                    const rec: StopTime = {
                        arrival_time: Array.isArray(pair) ? toTime(pair[0] ?? null) : pair?.arrival_time,
                        departure_time: Array.isArray(pair) ? toTime(pair[1] ?? null) : pair?.departure_time,
                        stop_sequence: s.stop_sequence
                    };
                    // injecte l'enregistrement sur le stop dans l'ordre d'affichage (idx)
                    byStop[idx].push(rec);
                }
            }
            for (let i = 0; i < stops.length; i++) stops[i].stop_times = byStop[i];
        }
        return stops;
    }, [route]);

    // Déterminer l'index du trip à afficher: priorité à selectedTripId, sinon selectedTripIndex, sinon 0
    const selectedIndex = useMemo(() => {
        if (!route) return 0;
        const schedules = route.properties?.trip_schedules;
        if (selectedTripId && Array.isArray(schedules) && schedules.length) {
            const idx = schedules.findIndex(s => s.trip_id === selectedTripId);
            if (idx >= 0) return idx;
        }
        if (typeof selectedTripIndex === 'number' && isFinite(selectedTripIndex)) {
            return Math.max(0, Math.floor(selectedTripIndex));
        }
        return 0;
    }, [route, selectedTripId, selectedTripIndex]);

    // Ordonner les stops selon la direction du trip sélectionné (si connue)
    const stopsToRender = useMemo(() => {
        const stops = normalizedStops;
        const schedules = route?.properties?.trip_schedules;
        if (!stops || !stops.length) return [] as Stop[];
        if (Array.isArray(schedules) && schedules[selectedIndex]) {
            const dir = Number(schedules[selectedIndex]?.direction_id) || 0;
            if (dir === 1) return [...stops].reverse();
        }
        return stops;
    }, [normalizedStops, route, selectedIndex]);

    // Map realtime updates par stopSequence => delay
    const realtimeBySequence = useMemo(() => {
        const m = new Map<number, { arrivalDelay: number | null; departureDelay: number | null }>();
        const ups = realtimeTripUpdate?.stopTimeUpdates || [];
        for (const up of ups) {
            m.set(up.stopSequence, { arrivalDelay: up.arrivalDelaySecs, departureDelay: up.departureDelaySecs });
        }
        return m;
    }, [realtimeTripUpdate]);

    useEffect(() => {
        if (route) {
            console.log("[RouteInfoPanel] route data:", route);
            console.log("[RouteInfoPanel] stops:", normalizedStops);
            console.log("[RouteInfoPanel] selected index:", selectedIndex, "selectedTripId:", selectedTripId);
        }
    }, [route, normalizedStops, selectedIndex, selectedTripId]);

    if (!route) return null;

    const delayColors = {
        late2: "text-red-600",
        late1: "text-orange-500",
        onTime: "text-green-700",
        early2: "text-blue-600",
        early1: "text-cyan-500",
        missing: "text-grey-400",
    } as const;

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
                    <p className="text-sm text-gray-500">{routeId}</p>
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
                    {stopsToRender.map((stop, i) => {
                        const times = stop.stop_times || [];
                        const st = times[selectedIndex] || times.find(t => t?.arrival_time || t?.departure_time) || times[0];
                        const key = st ? `${stop.stop_id}-${st.stop_sequence ?? i}` : `${stop.stop_id}-${i}`;
                        // delay temps réel – priorité departure sinon arrival
                        const rt = realtimeBySequence.get(st?.stop_sequence ?? -999);
                        const effectiveDelay = rt?.departureDelay ?? rt?.arrivalDelay ?? st?.delay;
                        // classification
                        const delayClass = (() => {
                            if (effectiveDelay == null) return 'missing';
                            if (effectiveDelay > 180) return 'late2';
                            if (effectiveDelay > 60) return 'late1';
                            if (effectiveDelay < -180) return 'early2';
                            if (effectiveDelay < -60) return 'early1';
                            return 'onTime';
                        })();
                        const formatDelay = (d?: number | null) => {
                            if (d == null) return '+0m';
                            const sign = d >= 0 ? '+' : '-';
                            const mins = Math.round(Math.abs(d) / 60);
                            return `${sign}${mins}m`;
                        };
                        return (
                            <li key={key} className="relative flex items-center my-4 z-10">
                                <div className="flex flex-col items-end text-[0.9em] w-[12%] pr-2">
                                    {st && (
                                        <>
                                            <span className={`font-semibold ${getDelayClass(effectiveDelay ?? undefined)}`}>{formatDelay(effectiveDelay)}</span>
                                            <span className="text-gray-600">{st.arrival_time || "--:--"}</span>
                                            <span className="text-gray-400 text-[0.75em]">{st.departure_time || ""}</span>
                                        </>
                                    )}
                                </div>
                                <div className="absolute bg-white border-2 border-blue-600 rounded-full w-[10px] h-[10px] z-10" style={{ left: "21%", transform: "translateX(-50%)" }} />
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
