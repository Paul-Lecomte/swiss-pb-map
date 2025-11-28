import React, { useEffect, useMemo, useRef, useState } from "react";

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

// Compact schedule time format: either [arrivalSec, departureSec] or objects with time strings
type ScheduleTime = [number | null, number | null] | { arrival_time?: string; departure_time?: string };

interface RoutePropsShape {
    stops: Stop[];
    route_id?: string;
    route_short_name: string;
    route_long_name?: string;
    trip_headsign: string;
    trip_schedules?: Array<{ trip_id: string; times: ScheduleTime[]; direction_id?: number }>; // optional compact format
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
    realtimeTripUpdate?: RealtimeTripUpdate; // realtime object for the currently selected trip
}

// Helpers
const parseGtfsTime = (s?: string): number | null => {
    if (!s) return null;
    const p = s.split(":").map((x) => parseInt(x, 10));
    if (p.length < 2 || p.some((v) => Number.isNaN(v))) return null;
    const [h = 0, m = 0, sec = 0] = p;
    return h * 3600 + m * 60 + sec;
};

const RouteInfoPanel: React.FC<RouteInfoPanelProps> = ({ route, onClose, selectedTripIndex, selectedTripId, realtimeTripUpdate }) => {
    const routeId = route?.route_id || route?.properties?.route_id || "";

    // 1) Normalize stops: if stop_times missing, rebuild from trip_schedules (respect direction)
    const normalizedStops = useMemo<Stop[]>(() => {
        if (!route?.properties?.stops) return [];
        const stops = route.properties.stops.map((s) => ({ ...s }));
        const schedules = route.properties.trip_schedules;
        const hasStopTimes = stops.some((s) => Array.isArray(s.stop_times) && s.stop_times.length > 0);
        if (schedules && schedules.length && !hasStopTimes) {
            const byStop: StopTime[][] = stops.map(() => []);
            const toTime = (sec: number | null) => {
                if (sec == null || !isFinite(sec)) return undefined;
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const pad = (n: number) => String(n).padStart(2, "0");
                return `${pad(h)}:${pad(m)}:${pad(s)}`;
            };
            const N = stops.length;
            for (let v = 0; v < schedules.length; v++) {
                const times = schedules[v].times || [];
                const dir = Number(schedules[v]?.direction_id) || 0;
                for (let i = 0; i < N; i++) {
                    const idx = dir === 1 ? N - 1 - i : i;
                    const s = stops[idx];
                    const pair = times[idx];
                    const rec: StopTime = {
                        arrival_time: Array.isArray(pair) ? toTime((pair as [number | null, number | null])[0] ?? null) : (pair as { arrival_time?: string })?.arrival_time,
                        departure_time: Array.isArray(pair) ? toTime((pair as [number | null, number | null])[1] ?? null) : (pair as { departure_time?: string })?.departure_time,
                        stop_sequence: s.stop_sequence,
                    };
                    byStop[idx].push(rec);
                }
            }
            for (let i = 0; i < stops.length; i++) stops[i].stop_times = byStop[i];
        }
        return stops;
    }, [route]);

    // 2) Determine selected trip index (prefer selectedTripId, else provided index, else 0)
    const selectedIndex = useMemo(() => {
        if (!route) return 0;
        const schedules = route.properties?.trip_schedules;
        if (selectedTripId && Array.isArray(schedules) && schedules.length) {
            const idx = schedules.findIndex((s) => s.trip_id === selectedTripId);
            if (idx >= 0) return idx;
        }
        if (typeof selectedTripIndex === "number" && isFinite(selectedTripIndex)) {
            return Math.max(0, Math.floor(selectedTripIndex));
        }
        return 0;
    }, [route, selectedTripId, selectedTripIndex]);

    // 3) Order stops according to selected trip direction (if known)
    const stopsToRender = useMemo<Stop[]>(() => {
        const stops = normalizedStops;
        const schedules = route?.properties?.trip_schedules;
        if (!stops || !stops.length) return [];
        if (Array.isArray(schedules) && schedules[selectedIndex]) {
            const dir = Number(schedules[selectedIndex]?.direction_id) || 0;
            if (dir === 1) return [...stops].reverse();
        }
        return stops;
    }, [normalizedStops, route, selectedIndex]);

    // 4) Realtime mapping by stopSequence => delays and absolute times
    const realtimeBySequence = useMemo(() => {
        const m = new Map<number, { arrivalDelay: number | null; departureDelay: number | null; arrivalTimeSecs: number | null; departureTimeSecs: number | null }>();
        const ups = realtimeTripUpdate?.stopTimeUpdates || [];
        for (const up of ups) {
            m.set(up.stopSequence, {
                arrivalDelay: up.arrivalDelaySecs,
                departureDelay: up.departureDelaySecs,
                arrivalTimeSecs: up.arrivalTimeSecs,
                departureTimeSecs: up.departureTimeSecs,
            });
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

    // 5) Compute continuous progress (0..1) based on realtime absolute times when available
    const [progress, setProgress] = useState<number>(0);
    const timerRef = useRef<number | null>(null);

    const computeProgress = useMemo(() => {
        // Absolute times (seconds) for the selected trip at each stop
        const absTimes: Array<number | null> = [];
        for (let i = 0; i < stopsToRender.length; i++) {
            const stop = stopsToRender[i];
            const times = stop.stop_times || [];
            const st =
                times[selectedIndex] ||
                times.find((t) => t?.arrival_time || t?.departure_time) ||
                times[0];
            if (!st) {
                absTimes.push(null);
                continue;
            }
            const rt = realtimeBySequence.get(st.stop_sequence ?? -999);
            const tSecRt = (rt?.departureTimeSecs ?? rt?.arrivalTimeSecs) ?? null;
            const tSecPlanned = parseGtfsTime(st.departure_time || st.arrival_time || undefined);
            absTimes.push(tSecRt != null ? tSecRt : tSecPlanned);
        }
        const first = absTimes.find((t) => t != null) ?? null;
        const last = [...absTimes].reverse().find((t) => t != null) ?? null;
        return (now: Date) => {
            if (first == null || last == null || last <= first) return 0;
            const nowSec =
                now.getHours() * 3600 +
                now.getMinutes() * 60 +
                now.getSeconds() +
                now.getMilliseconds() / 1000;
            // Shift across days to handle >24:00 and midnight wrap
            let effective = nowSec;
            for (let k = -1; k <= 1; k++) {
                const shifted = nowSec + k * 86400;
                if (shifted >= first && shifted <= last) {
                    effective = shifted;
                    break;
                }
            }
            const p = (effective - first) / (last - first);
            return Math.min(1, Math.max(0, p));
        };
    }, [stopsToRender, selectedIndex, realtimeBySequence]);

    useEffect(() => {
        const tick = () => {
            setProgress(computeProgress(new Date()));
            timerRef.current = window.setTimeout(tick, 500) as unknown as number;
        };
        tick();
        return () => {
            if (timerRef.current != null) window.clearTimeout(timerRef.current);
        };
    }, [computeProgress]);

    // After hooks, if route is not available, render nothing
    if (!route) return null;

    // Delay color helpers (CSS utility classes)
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

    return (
        <div className="absolute top-[85px] left-4 w-[30%] max-w-[400px] h-[80vh] bg-white rounded-lg shadow-lg font-[Segoe_UI] overflow-y-auto p-4 z-[9999] transition-all duration-300 md:w-[40%] sm:w-[90%] sm:left-[5%] sm:top-[70px] sm:h-[70vh]">
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
                <button onClick={onClose} className="absolute right-0 top-0 text-gray-500 hover:text-black text-xl" aria-label="Close route info">
                    ✖
                </button>
            </div>

            {/* TIMELINE */}
            <div className="relative mt-4 pl-6 pr-4">
                {/* Vertical polyline */}
                <div className="absolute left-[35%] sm:left-[25%] top-0 bottom-0 w-[2px] bg-blue-600 rounded-full z-0" />

                {/* Moving vehicle dot aligned to the polyline */}
                <div
                    className="absolute left-[35%] sm:left-[25%] w-3 h-3 bg-blue-600 border-2 border-white rounded-full z-20"
                    style={{ top: `${progress * 100}%`, transform: "translate(-50%, -50%)", transition: "top 0.4s ease" }}
                    aria-label="Vehicle current position along the route"
                />

                <ul className="list-none p-0 m-0 relative">
                    {stopsToRender.map((stop, i) => {
                        const times = stop.stop_times || [];
                        const st =
                            times[selectedIndex] ||
                            times.find((t) => t?.arrival_time || t?.departure_time) ||
                            times[0];
                        const key = st ? `${stop.stop_id}-${st.stop_sequence ?? i}` : `${stop.stop_id}-${i}`;
                        const rt = st ? realtimeBySequence.get(st.stop_sequence ?? -999) : undefined;
                        const effectiveDelay = rt?.departureDelay ?? rt?.arrivalDelay ?? st?.delay;
                        const formatDelayShort = (d?: number | null) => {
                            if (d == null) return "+0m";
                            const sign = d >= 0 ? "+" : "-";
                            const mins = Math.round(Math.abs(d) / 60);
                            return `${sign}${mins}m`;
                        };
                        return (
                            <li key={key} className="relative flex items-center my-4 z-10">
                                <div className="flex flex-col items-end text-[0.9em] w-[12%] pr-2">
                                    {st && (
                                        <>
                                            <span className={`font-semibold ${getDelayClass(effectiveDelay ?? undefined)}`}>{formatDelayShort(effectiveDelay)}</span>
                                            <span className="text-gray-600">{st?.arrival_time || "--:--"}</span>
                                            <span className="text-gray-400 text-[0.75em]">{st?.departure_time || ""}</span>
                                        </>
                                    )}
                                </div>
                                {/* Stop bullet (separate from the polyline for readability) */}
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

