"use client";
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Marker } from "react-leaflet";
import L, { Marker as LeafletMarker } from "leaflet";
import { useMap } from "react-leaflet";

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
    zoomLevel?: number;
}

const parseGtfsTime = (s?: unknown): number | null => {
    if (typeof s !== "string") return null;
    const parts = s.split(":").map(p => parseInt(p, 10));
    if (parts.length < 2 || parts.some(isNaN)) return null;
    const [hours = 0, mins = 0, secs = 0] = parts;
    return hours * 3600 + mins * 60 + secs;
};

const sq = (v: number) => v * v;
const dist2 = (a: LatLngTuple, b: LatLngTuple) => sq(a[0] - b[0]) + sq(a[1] - b[1]);

// Global animation registry to avoid one RAF per vehicle
const animationSubscribers = new Set<() => void>();
let globalAnimating = false;
const startGlobalAnimation = () => {
    if (globalAnimating) return;
    globalAnimating = true;
    const step = () => {
        if (document.hidden) { // skip updates while hidden
            requestAnimationFrame(step);
            return;
        }
        for (const fn of animationSubscribers) fn();
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
};
if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        // When back visible we ensure loop running
        if (!document.hidden) startGlobalAnimation();
    });
}

// Douglas-Peucker polyline simplification to limit stored path points
function simplify(coords: LatLngTuple[], tolerance = 1e-5, maxPoints = 300): LatLngTuple[] {
    if (coords.length <= maxPoints) return coords;
    // Basic DP implementation
    const sqTol = tolerance * tolerance;
    const keep = new Array(coords.length).fill(false);
    keep[0] = keep[coords.length - 1] = true;
    type Segment = { first: number; last: number };
    const stack: Segment[] = [{ first: 0, last: coords.length - 1 }];
    const sqSegDist = (p: LatLngTuple, a: LatLngTuple, b: LatLngTuple) => {
        let x = a[0]; let y = a[1];
        let dx = b[0] - x; let dy = b[1] - y;
        if (dx !== 0 || dy !== 0) {
            const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) { x = b[0]; y = b[1]; }
            else if (t > 0) { x += dx * t; y += dy * t; }
        }
        dx = p[0] - x; dy = p[1] - y;
        return dx * dx + dy * dy;
    };
    while (stack.length) {
        const { first, last } = stack.pop()!;
        let maxSqDist = 0; let index = -1;
        for (let i = first + 1; i < last; i++) {
            const sqDist = sqSegDist(coords[i], coords[first], coords[last]);
            if (sqDist > maxSqDist) { index = i; maxSqDist = sqDist; }
        }
        if (maxSqDist > sqTol && index !== -1) {
            keep[index] = true;
            stack.push({ first, last: index }, { first: index, last });
        }
    }
    const simplified: LatLngTuple[] = [];
    for (let i = 0; i < coords.length; i++) if (keep[i]) simplified.push(coords[i]);
    // If still too many points, downsample evenly
    if (simplified.length > maxPoints) {
        const stepSize = simplified.length / maxPoints;
        const reduced: LatLngTuple[] = [];
        for (let i = 0; i < maxPoints; i++) {
            reduced.push(simplified[Math.floor(i * stepSize)]);
        }
        return reduced;
    }
    return simplified;
}

const Vehicle: React.FC<VehicleProps> = ({
                                             routeShortName,
                                             coordinates,
                                             stopTimes,
                                             color = "#FF4136",
                                             onClick,
                                             zoomLevel: zoomFromProps,
                                         }) => {
    const markerRef = useRef<LeafletMarker | null>(null);
    const map = useMap();
    const [zoomLevelState, setZoomLevelState] = useState<number>(() => {
        if (typeof zoomFromProps === 'number') return zoomFromProps;
        try { return map.getZoom?.() ?? 13; } catch { return 13; }
    });
    useEffect(() => {
        if (typeof zoomFromProps === 'number') {
            setZoomLevelState(zoomFromProps);
            return;
        }
        const update = () => {
            try { setZoomLevelState(map.getZoom?.() ?? 13); } catch {}
        };
        map.on('zoomend', update);
        return () => { map.off('zoomend', update); };
    }, [map, zoomFromProps]);

    const cache = useMemo(() => {
        let coords = (coordinates || []).map(c => [Number(c[0]), Number(c[1])] as LatLngTuple).filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]));
        // Simplify to cap memory & distance calc arrays
        coords = simplify(coords, 5e-6, 300);
        const prelimStopIndices: number[] = [];
        const stopTimesSec: (number | null)[] = [];

        for (const s of (stopTimes || [])) {
            const lat = Number(s.stop_lat);
            const lon = Number(s.stop_lon);
            stopTimesSec.push(parseGtfsTime(s.arrival_time ?? s.departure_time ?? undefined));
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                prelimStopIndices.push(-1);
                continue;
            }
            let bestIdx = -1;
            let bestD = Infinity;
            for (let i = 0; i < coords.length; i++) {
                const d = dist2(coords[i], [lat, lon]);
                if (d < bestD) {
                    bestD = d;
                    bestIdx = i;
                }
            }
            prelimStopIndices.push(bestIdx);
        }

        const firstValidIdx = prelimStopIndices.find(idx => idx >= 0);
        const lastValidIdx = [...prelimStopIndices].reverse().find(idx => idx >= 0);
        const isReversedGeom =
            typeof firstValidIdx === "number" && typeof lastValidIdx === "number" && firstValidIdx > lastValidIdx;

        let stopIndices: number[];
        if (isReversedGeom) {
            const n = coords.length;
            coords = [...coords].reverse();
            stopIndices = prelimStopIndices.map(idx => (idx >= 0 ? (n - 1 - idx) : -1));
        } else {
            stopIndices = prelimStopIndices;
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

        const cumDistArr: number[] = [0];
        for (let i = 1; i < coords.length; i++) {
            const a = coords[i - 1];
            const b = coords[i];
            const dx = a[0] - b[0];
            const dy = a[1] - b[1];
            cumDistArr[i] = cumDistArr[i - 1] + Math.sqrt(dx * dx + dy * dy);
        }
        const cumDist = new Float32Array(cumDistArr);
        return { coords, stopIndices, stopTimesSec, segments, cumDist };
    }, [coordinates, stopTimes]);

    const computePositionForSeconds = useCallback((secondsNow: number): LatLngTuple | null => {
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
    }, [cache]);

    const firstNonNull = cache.stopTimesSec.find(t => t != null) ?? null;
    const lastNonNull = [...cache.stopTimesSec].reverse().find(t => t != null) ?? null;

    const getEffectiveNowSec = useCallback((d: Date) => {
        const base = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
        if (firstNonNull !== null && lastNonNull !== null) {
            for (let k = -1; k <= 1; k++) {
                const shifted = base + k * 86400;
                if (shifted >= firstNonNull && shifted <= lastNonNull) return shifted;
            }
        }
        return base;
    }, [firstNonNull, lastNonNull]);

    const [position, setPosition] = useState<LatLngTuple | null>(() => {
        const now = new Date();
        const secondsNow = getEffectiveNowSec(now);
        return computePositionForSeconds(secondsNow);
    });

    // Hover state and handlers must be declared unconditionally (before any early return)
    const [hovered, setHovered] = useState(false);
    const handleMouseOver = useCallback(() => setHovered(true), []);
    const handleMouseOut = useCallback(() => setHovered(false), []);

    useEffect(() => {
        // Register global animation callback instead of per-component RAF loop
        const update = () => {
            const date = new Date();
            const secondsNow = getEffectiveNowSec(date);
            const p = computePositionForSeconds(secondsNow);
            if (p) {
                if (markerRef.current) markerRef.current.setLatLng(p);
                else setPosition(p); // initial mount fallback
            }
        };
        animationSubscribers.add(update);
        startGlobalAnimation();
        return () => {
            animationSubscribers.delete(update);
        };
    }, [computePositionForSeconds, getEffectiveNowSec]);

    const now = new Date();
    const effectiveNowSec = getEffectiveNowSec(now);
    const active = firstNonNull !== null && lastNonNull !== null &&
        effectiveNowSec >= firstNonNull && effectiveNowSec <= lastNonNull;

    // NOTE: Do NOT early-return based on `active` before all hooks have run.
    // Doing so would change hook order between renders and trigger React warnings.
    // We compute sizing/icon regardless, and conditionally render null at the end.

    const computeFontSize = (text: string, diameter: number) => {
        const maxFont = diameter / 2;
        return Math.min(maxFont, diameter / Math.max(text.length, 1));
    };

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const baseDiameter = clamp(8 + 1.2 * (zoomLevelState - 10), 8, 22);

    const hoverScale = 2.5; // scale when hovered
    const diameter = hovered ? clamp(baseDiameter * hoverScale, 8, 50) : baseDiameter;
    const fontSize = routeShortName ? computeFontSize(routeShortName, diameter) : Math.max(8, Math.floor(diameter / 2));

    // build one-line style string to avoid CSS linter/validator issues
    const styleStr =
        `width:${diameter}px;height:${diameter}px;background-color:white;color:${color};font-size:${fontSize}px;font-weight:bold;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid ${color};box-shadow:0 0 3px rgba(0,0,0,0.3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;

    const icon = useMemo(() => new L.DivIcon({
        html: `<div style="${styleStr}">${routeShortName || ""}</div>`,
        className: "",
        iconSize: [diameter, diameter],
        iconAnchor: [diameter / 2, diameter / 2],
    }), [styleStr, diameter, routeShortName]);

    return active ? (
        <Marker
            ref={markerRef}
            position={(position || coordinates[0]) as LatLngTuple}
            icon={icon}
            eventHandlers={{
                click: onClick ? () => onClick() : undefined,
                mouseover: handleMouseOver,
                mouseout: handleMouseOut,
            }}
        />
    ) : null;
};

export default Vehicle;
