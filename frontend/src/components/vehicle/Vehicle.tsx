"use client";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";

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
    routeShortName?: string;
    coordinates: LatLngTuple[];
    stopTimes: StopTime[];
    color?: string;
    isRunning?: boolean;
    onClick?: () => void;
}

const parseGtfsTime = (s?: string): number | null => {
    if (!s) return null;
    const parts = s.split(":").map(p => parseInt(p, 10));
    if (parts.length < 2 || parts.some(isNaN)) return null;
    const hours = parts[0] || 0;
    const mins = parts[1] || 0;
    const secs = parts[2] || 0;
    return hours * 3600 + mins * 60 + secs;
};

const sq = (v: number) => v * v;
const dist2 = (a: LatLngTuple, b: LatLngTuple) => sq(a[0] - b[0]) + sq(a[1] - b[1]);

const Vehicle: React.FC<VehicleProps> = ({
                                             routeId: _routeId,
                                             routeShortName,
                                             coordinates,
                                             stopTimes,
                                             color = "#FF4136",
                                             isRunning = false,
                                             onClick,
                                         }) => {
    const markerRef = useRef<L.Marker>(null);

    const cache = useMemo(() => {
        const coords = (coordinates || []).map(c => [Number(c[0]), Number(c[1])] as LatLngTuple);
        const stopIndices: number[] = [];
        const stopTimesSec: (number | null)[] = [];

        for (const s of (stopTimes || [])) {
            const lat = Number(s.stop_lat);
            const lon = Number(s.stop_lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                stopIndices.push(-1);
            } else {
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

        type Seg = { startIdx: number; endIdx: number; startSec: number; endSec: number };
        const segments: Seg[] = [];
        for (let i = 0; i < stopIndices.length - 1; i++) {
            let a = stopIndices[i];
            let b = stopIndices[i + 1];
            const as = stopTimesSec[i];
            const bs = stopTimesSec[i + 1];
            if (a >= 0 && b >= 0 && as != null && bs != null && bs >= as) {
                if (a > b) [a, b] = [b, a];
                if (a !== b) segments.push({ startIdx: a, endIdx: b, startSec: as as number, endSec: bs as number });
            }
        }

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

    const computePositionForSeconds = (secondsNow: number): LatLngTuple | null => {
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
        return [a[0] + (b[0] - a[0]) * localFrac, a[1] + (b[1] - a[1]) * localFrac];
    };

    const [position, setPosition] = useState<LatLngTuple | null>(() => {
        const now = new Date();
        const secondsNow = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
        return computePositionForSeconds(secondsNow);
    });

    useEffect(() => {
        const animate = () => {
            const date = new Date();
            const secondsNow = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
            const p = computePositionForSeconds(secondsNow);
            if (p && markerRef.current) markerRef.current.setLatLng(p);
            else if (p) setPosition(p);
            requestAnimationFrame(animate);
        };
        const rafId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafId);
    }, [cache]);

    // dynamically compute font size based on text length
    const computeFontSize = (text: string, diameter: number) => {
        const maxFont = diameter / 2; // max font is half the diameter
        const size = Math.min(maxFont, diameter / Math.max(text.length, 1));
        return size;
    };

    const diameter = isRunning ? 26 : 22;
    const fontSize = routeShortName ? computeFontSize(routeShortName, diameter) : 12;

    const icon = new L.DivIcon({
        html: `<div style="
            width: ${diameter}px;
            height: ${diameter}px;
            background-color: white;
            color: ${color};
            font-size: ${fontSize}px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            border: 2px solid ${color};
            box-shadow: 0 0 3px rgba(0,0,0,0.3);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        ">${routeShortName || ""}</div>`,
        className: "",
        iconSize: [diameter, diameter],
        iconAnchor: [diameter / 2, diameter / 2],
    });

    if (!position && coordinates && coordinates.length > 0) {
        return <Marker ref={markerRef} position={coordinates[0]} icon={icon} eventHandlers={{ click: onClick ? () => onClick() : undefined }} />;
    }

    return (
        <Marker
            ref={markerRef}
            position={position as LatLngTuple}
            icon={icon}
            eventHandlers={{ click: onClick ? () => onClick() : undefined }}
        />
    );
};

export default Vehicle;