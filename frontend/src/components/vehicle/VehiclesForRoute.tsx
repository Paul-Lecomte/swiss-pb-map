"use client";
import React, { useMemo } from "react";
import Vehicle from "./Vehicle";

type LatLngTuple = [number, number];

interface StopTime {
    arrival_time?: string;
    departure_time?: string;
    stop_sequence?: number;
    stop_id?: string;
    stop_lat?: number;
    stop_lon?: number;
}

interface TripData {
    trip_id: string;
    stopTimes: StopTime[]; // ordered
}

interface VehiclesForRouteProps {
    routeId: string;
    coordinates: LatLngTuple[];
    trips: TripData[];
    runningTripId?: string | null; // optional external hint
    color?: string;
}

// Parse HH:MM:SS possibly >24 into seconds since midnight (can exceed 86400)
const parseGtfsTime = (s?: string): number | null => {
    if (!s) return null;
    const parts = s.split(":").map(p => parseInt(p, 10));
    if (parts.length < 2 || parts.some(isNaN)) return null;
    const hours = parts[0] || 0;
    const mins = parts[1] || 0;
    const secs = parts[2] || 0;
    return hours * 3600 + mins * 60 + secs;
};

// Decide if a trip is currently running by comparing now (with day shifts) against trip start/end seconds
const isTripRunningNow = (stopTimes: StopTime[]): boolean => {
    const times: number[] = [];
    for (const st of stopTimes) {
        const t = parseGtfsTime(st.departure_time || st.arrival_time || undefined);
        if (t !== null) times.push(t);
    }
    if (times.length === 0) return false;

    const start = Math.min(...times);
    const end = Math.max(...times);
    // current time as seconds since midnight
    const nowDate = new Date();
    const nowSec = nowDate.getHours() * 3600 + nowDate.getMinutes() * 60 + nowDate.getSeconds();

    // check now with shifts -1, 0, +1 day to match trips that span midnight or use >24:00 times
    for (let k = -1; k <= 1; k++) {
        const candidate = nowSec + k * 86400;
        if (candidate >= start && candidate <= end) return true;
    }

    return false;
};

const VehiclesForRoute: React.FC<VehiclesForRouteProps> = ({ routeId, coordinates, trips, runningTripId, color }) => {
    const runningTrips = useMemo(() => {
        if (!Array.isArray(trips) || trips.length === 0) return [];
        // filter trips that appear to be running now
        return trips.filter((t) => isTripRunningNow(t.stopTimes || []));
    }, [trips]);

    if (!runningTrips.length) return null;

    return (
        <>
            {runningTrips.map((trip) => (
                <Vehicle
                    key={`${routeId}-${trip.trip_id}`}
                    routeId={`${routeId}-${trip.trip_id}`}
                    coordinates={coordinates}
                    stopTimes={trip.stopTimes}
                    color={color}
                    isRunning={runningTripId === trip.trip_id}
                />
            ))}
        </>
    );
};

export default VehiclesForRoute;
