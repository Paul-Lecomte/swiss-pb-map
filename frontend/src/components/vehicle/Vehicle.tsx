"use client";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { CircleMarker } from "react-leaflet";
// don't import types from leaflet to avoid missing @types; declare local tuple
type LatLngTuple = [number, number];

interface StopTime {
    arrival_time?: string;
    departure_time?: string;
    stop_sequence?: number;
    stop_id?: string;
    stop_lat?: number;
    stop_lon?: number;
}

interface VehicleProps {
    routeId: string;
    coordinates: LatLngTuple[]; // positions along the route (lat, lon)
    stopTimes: StopTime[]; // ordered stops with times and lat/lon
    color?: string;
}

// Parse "HH:MM:SS" possibly with hours > 24 into seconds since midnight
const parseGtfsTime = (s?: string): number | null => {
    if (!s || typeof s !== "string") return null;
    const parts = s.split(":").map(p => parseInt(p, 10));
    if (parts.length < 2 || parts.some(isNaN)) return null;
    const hours = parts[0] || 0;
    const mins = parts[1] || 0;
    const secs = parts[2] || 0;
    return hours * 3600 + mins * 60 + secs;
};

const sq = (v: number) => v * v;

// approximate squared distance in degrees (fine for nearest index mapping)
const dist2 = (a: LatLngTuple, b: LatLngTuple) => sq(a[0] - b[0]) + sq(a[1] - b[1]);

const Vehicle: React.FC<VehicleProps> = ({ routeId, coordinates, stopTimes, color = "#FF4136" }) => {
    // recompute caches when inputs change (must be available during first render)
    const cache = useMemo(() => {
        const coords = (coordinates || []).map(c => [Number(c[0]), Number(c[1])] as LatLngTuple);
        // For each stop, find nearest index in coords
        const stopIndices: number[] = [];
        const stopTimesSec: (number | null)[] = [];

        for (const s of (stopTimes || [])) {
            const lat = Number(s.stop_lat);
            const lon = Number(s.stop_lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                stopIndices.push(-1);
            } else {
                // find nearest
                let bestIdx = -1;
                let bestD = Infinity;
                for (let i = 0; i < coords.length; i++) {
                    const d = dist2(coords[i], [lat, lon]);
                    if (d < bestD) {
                        bestD = d;
                        bestIdx = i;
                    }
                }
                stopIndices.push(bestIdx);
            }
            stopTimesSec.push(parseGtfsTime(s.arrival_time ?? s.departure_time ?? undefined));
        }

        // Build segments between valid consecutive stops
        type Seg = {
            startIdx: number;
            endIdx: number;
            startSec: number;
            endSec: number;
        };
        const segments: Seg[] = [];
        for (let i = 0; i < stopIndices.length - 1; i++) {
            let a = stopIndices[i];
            let b = stopIndices[i + 1];
            const as = stopTimesSec[i];
            const bs = stopTimesSec[i + 1];
            if (a >= 0 && b >= 0 && as != null && bs != null && bs >= as) {
                // Ensure indices are ordered along the geometry; if not, swap them but keep times aligned
                if (a > b) {
                    const tmpIdx = a; a = b; b = tmpIdx;
                }
                if (a !== b) segments.push({ startIdx: a, endIdx: b, startSec: as as number, endSec: bs as number });
            }
        }

        // Precompute cumulative distances along coords to allow interpolation by fraction
        const cumDist: number[] = [0];
        for (let i = 1; i < coords.length; i++) {
            const a = coords[i - 1];
            const b = coords[i];
            const dx = a[0] - b[0];
            const dy = a[1] - b[1];
            cumDist[i] = cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy);
        }

        return { coords, stopIndices, stopTimesSec, segments, cumDist };
    }, [coordinates, stopTimes]);

    // synchronous helper to compute position for a given seconds-of-day using the cache
    const computePositionForSeconds = (secondsNow: number) : LatLngTuple | null => {
        const c = cache;
        if (!c || !c.segments || c.segments.length === 0) {
            if (c.coords && c.coords.length) return c.coords[0];
            return null;
        }

        let seg: typeof c.segments[0] | null = null;
        for (const s of c.segments) {
            if (secondsNow >= s.startSec && secondsNow <= s.endSec) { seg = s; break; }
        }

        if (!seg) {
            const first = c.segments[0];
            const last = c.segments[c.segments.length - 1];
            if (secondsNow < first.startSec) return c.coords[first.startIdx];
            if (secondsNow > last.endSec) return c.coords[last.endIdx];
            // find nearest by time
            let best = c.segments[0];
            let bestDist = Math.abs(secondsNow - best.endSec);
            for (const s of c.segments) {
                const d = Math.min(Math.abs(secondsNow - s.startSec), Math.abs(secondsNow - s.endSec));
                if (d < bestDist) { bestDist = d; best = s; }
            }
            return c.coords[best.endIdx];
        }

        const { startIdx, endIdx, startSec, endSec } = seg;
        const frac = (secondsNow - startSec) / Math.max(1, (endSec - startSec));
        const cum = c.cumDist;
        const segStartDist = cum[startIdx] ?? 0;
        const segEndDist = cum[endIdx] ?? segStartDist + 1;
        const targetDist = segStartDist + (segEndDist - segStartDist) * frac;

        let i = startIdx;
        while (i < endIdx && cum[i + 1] < targetDist) i++;
        const d0 = cum[i];
        const d1 = cum[i + 1] ?? d0 + 1;
        const localFrac = (targetDist - d0) / Math.max(1e-6, (d1 - d0));
        const a = c.coords[i];
        const b = c.coords[i + 1] ?? a;
        const lat = a[0] + (b[0] - a[0]) * localFrac;
        const lon = a[1] + (b[1] - a[1]) * localFrac;
        return [lat, lon];
    };

    // initial position computed synchronously from cache and current time to avoid jumping to start on remount
    const now = new Date();
    const secondsNow = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const initialPos = computePositionForSeconds(secondsNow);

    const [position, setPosition] = useState<LatLngTuple | null>(initialPos);

    // Keep stable refs so re-renders or remounts recompute purely from time and geometry
    const rafRef = useRef<number | null>(null);
    const coordsRef = useRef<LatLngTuple[]>(coordinates || []);
    const stopsRef = useRef<StopTime[]>(stopTimes || []);

    useEffect(() => {
        coordsRef.current = cache.coords;
        stopsRef.current = stopTimes || [];

        const tick = () => {
            const now = new Date();
            const secondsNow = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            const p = computePositionForSeconds(secondsNow);
            if (p) setPosition(p);
        };

        const loop = () => {
            tick();
            rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, [cache, stopTimes]);

    if (!position) return null;

    return (
        <CircleMarker
            center={position as LatLngTuple}
            pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 1,
                weight: 1,
            }}
            radius={6}
        />
    );
};

export default Vehicle;
