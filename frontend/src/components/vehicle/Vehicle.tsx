"use client";
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Marker } from "react-leaflet";
import L, { Marker as LeafletMarker, TooltipOptions } from "leaflet";
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

interface RealtimeStopTimeUpdate {
    stopId: string;
    stopSequence: number;
    arrivalTimeSecs: number | null;
    departureTimeSecs: number | null;
    arrivalDelaySecs: number | null;
    departureDelaySecs: number | null;
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
    realtimeStopTimeUpdates?: RealtimeStopTimeUpdate[] | null; // ajout temps réel spécifique à ce trip
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
                                             realtimeStopTimeUpdates,
                                         }) => {
    const markerRef = useRef<LeafletMarker | null>(null);
    // High-res displayed position smoothing ref (does NOT store history)
    const displayedPosRef = useRef<LatLngTuple | null>(null);
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
        coords = simplify(coords, 5e-6, 300);
        const prelimStopIndices: number[] = [];
        const stopTimesSec: (number | null)[] = [];
        // Fusion des horaires statiques + temps réel
        const rtMap = new Map<number, RealtimeStopTimeUpdate>();
        (realtimeStopTimeUpdates || []).forEach(up => {
            // stopSequence est déjà number
            rtMap.set(up.stopSequence, up);
        });
        for (const s of (stopTimes || [])) {
            const baseTimeStr = s.departure_time || s.arrival_time || undefined;
            let baseSecs = parseGtfsTime(baseTimeStr);
            if (typeof s.stop_sequence === 'number') {
                const rt = rtMap.get(s.stop_sequence);
                if (rt) {
                    const realSecs = rt.departureTimeSecs ?? rt.arrivalTimeSecs;
                    if (realSecs != null) {
                        baseSecs = realSecs;
                    } else if (rt.departureDelaySecs != null && baseSecs != null) {
                        baseSecs = baseSecs + rt.departureDelaySecs;
                    } else if (rt.arrivalDelaySecs != null && baseSecs != null) {
                        baseSecs = baseSecs + rt.arrivalDelaySecs; // nouveau fallback sur arrivalDelay
                    }
                }
            }
            stopTimesSec.push(baseSecs);
            const lat = Number(s.stop_lat);
            const lon = Number(s.stop_lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                prelimStopIndices.push(-1);
                continue;
            }
            let bestIdx = -1;
            let bestD = Infinity;
            for (let i = 0; i < coords.length; i++) {
                const d = dist2(coords[i], [lat, lon]);
                if (d < bestD) { bestD = d; bestIdx = i; }
            }
            prelimStopIndices.push(bestIdx);
        }
        const firstValidIdx = prelimStopIndices.find(idx => idx >= 0);
        const lastValidIdx = [...prelimStopIndices].reverse().find(idx => idx >= 0);
        const isReversedGeom = typeof firstValidIdx === "number" && typeof lastValidIdx === "number" && firstValidIdx > lastValidIdx;
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
            const A = coords[i - 1];
            const B = coords[i];
            const dx = A[0] - B[0];
            const dy = A[1] - B[1];
            cumDistArr[i] = cumDistArr[i - 1] + Math.sqrt(dx * dx + dy * dy);
        }
        const cumDist = new Float32Array(cumDistArr);
        return { coords, stopIndices, stopTimesSec, segments, cumDist };
    }, [coordinates, stopTimes, realtimeStopTimeUpdates]);

    const computePositionForSeconds = useCallback((secondsNow: number): LatLngTuple | null => {
        // Accept fractional seconds for smoother interpolation
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
        // Integer seconds for active state checks
        const base = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
        if (firstNonNull !== null && lastNonNull !== null) {
            for (let k = -1; k <= 1; k++) {
                const shifted = base + k * 86400;
                if (shifted >= firstNonNull && shifted <= lastNonNull) return shifted;
            }
        }
        return base;
    }, [firstNonNull, lastNonNull]);

    // High-resolution fractional seconds (with day shift handling) for smooth interpolation
    const getEffectiveNowSecHighRes = useCallback((d: Date) => {
        const msInDay = d.getHours() * 3600_000 + d.getMinutes() * 60_000 + d.getSeconds() * 1000 + d.getMilliseconds();
        const secondsFloat = msInDay / 1000;
        if (firstNonNull !== null && lastNonNull !== null) {
            for (let k = -1; k <= 1; k++) {
                const shifted = secondsFloat + k * 86400;
                if (shifted >= firstNonNull && shifted <= lastNonNull) return shifted;
            }
        }
        return secondsFloat;
    }, [firstNonNull, lastNonNull]);

    const [position, setPosition] = useState<LatLngTuple | null>(() => {
        const now = new Date();
        const secondsNow = getEffectiveNowSec(now);
        return computePositionForSeconds(secondsNow);
    });

    // État hover remis ici avant utilisation plus bas
    const [hovered, setHovered] = useState(false);
    const handleMouseOver = useCallback(() => setHovered(true), []);
    const handleMouseOut = useCallback(() => setHovered(false), []);

    // Calcul du retard/avance courant déplacé avant l’effet d’animation
    const computeCurrentDelaySecs = useCallback((): number | null => {
        if (!realtimeStopTimeUpdates || realtimeStopTimeUpdates.length === 0) return null;
        const now = new Date();
        const nowSecFloat = getEffectiveNowSecHighRes(now);
        const enriched = realtimeStopTimeUpdates.map(u => {
            const time = (u.departureTimeSecs != null ? u.departureTimeSecs : u.arrivalTimeSecs);
            const delay = (u.departureDelaySecs != null ? u.departureDelaySecs : u.arrivalDelaySecs);
            return { sequence: u.stopSequence, time, delay };
        }).filter(e => e.time != null);
        if (!enriched.length) return null;
        const past = enriched.filter(e => (e.time as number) <= nowSecFloat).sort((a,b) => (b.time as number) - (a.time as number));
        if (past.length) return past[0].delay ?? null;
        const future = enriched.filter(e => (e.time as number) > nowSecFloat).sort((a,b) => (a.time as number) - (b.time as number));
        if (future.length) return future[0].delay ?? null;
        return null;
    }, [realtimeStopTimeUpdates, getEffectiveNowSecHighRes]);
    const currentDelaySecs = computeCurrentDelaySecs();

    // Fonction de scaling temporel pour adapter la vitesse au retard/avance
    const computeScaledTime = useCallback((secondsNowFloat: number) => {
        if (currentDelaySecs == null || firstNonNull == null || lastNonNull == null) return secondsNowFloat;
        const totalDuration = lastNonNull - firstNonNull;
        if (totalDuration <= 0) return secondsNowFloat;
        let elapsed = secondsNowFloat - firstNonNull;
        if (elapsed < 0) elapsed = 0; else if (elapsed > totalDuration) elapsed = totalDuration;
        const denom = Math.max(30, totalDuration + currentDelaySecs); // garde positif
        const factor = totalDuration / denom; // <1 ralentit (retard), >1 accélère (avance)
        const scaledElapsed = elapsed * factor;
        return firstNonNull + scaledElapsed;
    }, [currentDelaySecs, firstNonNull, lastNonNull]);

    useEffect(() => {
        // Register global animation callback instead of per-component RAF loop
        const update = () => {
            const now = new Date();
            const secondsNowFloat = getEffectiveNowSecHighRes(now);
            const interpTime = computeScaledTime(secondsNowFloat);
            const target = computePositionForSeconds(interpTime);
            if (!target) return;
            const current = displayedPosRef.current;
            if (!current) {
                displayedPosRef.current = target;
                if (markerRef.current) markerRef.current.setLatLng(target); else setPosition(target);
                return;
            }
            const smoothing = 0.18;
            const newLat = current[0] + (target[0] - current[0]) * smoothing;
            const newLon = current[1] + (target[1] - current[1]) * smoothing;
            const newPos: LatLngTuple = [newLat, newLon];
            displayedPosRef.current = newPos;
            if (markerRef.current) markerRef.current.setLatLng(newPos); else setPosition(newPos);
        };
        animationSubscribers.add(update);
        startGlobalAnimation();
        return () => { animationSubscribers.delete(update); };
    }, [computePositionForSeconds, getEffectiveNowSecHighRes, computeScaledTime]);

    const computeFontSize = (text: string, diameter: number) => {
        const maxFont = diameter / 2;
        return Math.min(maxFont, diameter / Math.max(text.length, 1));
    };

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const baseDiameter = clamp(8 + 1.2 * (zoomLevelState - 10), 8, 22);

    const hoverScale = 2.2; // facteur d'agrandissement au survol
    const scale = hovered ? hoverScale : 1;
    const diameter = baseDiameter; // keep constant; visual size changes via transform only
    const fontSize = routeShortName ? computeFontSize(routeShortName, diameter) : Math.max(8, Math.floor(diameter / 2));

    // Subtle box-shadow expansion on hover
    const boxShadow = "0 0 3px rgba(0,0,0,0.3)";

    // Analyse temps réel courant (dernier stop passé ou prochain)
    const delayClassColor = (() => {
        if (currentDelaySecs == null) return null;
        if (currentDelaySecs > 120) return '#d32f2f';
        if (currentDelaySecs > 60) return '#f57c00';
        if (currentDelaySecs > 0) return '#ffa726';
        if (currentDelaySecs < -120) return '#1565c0';
        if (currentDelaySecs < -60) return '#1e88e5';
        if (currentDelaySecs < 0) return '#42a5f5';
        return '#2e7d32';
    })();

    const formatDelayLabel = (d: number | null) => {
        if (d == null) return '';
        const abs = Math.abs(d);
        if (abs >= 3600) {
            const hours = abs / 3600;
            const hStr = (Math.round(hours * 10) / 10).toFixed(1).replace(/\.0$/, '');
            return `${d > 0 ? '+' : '-'}${hStr}h`;
        }
        if (abs < 60) return `${d > 0 ? '+' : '-'}${abs}s`;
        const mins = Math.round(abs / 60);
        return `${d > 0 ? '+' : '-'}${mins}m`;
    };

    const borderColor = delayClassColor || color;
    const styleStr = `position:relative;width:${diameter}px;height:${diameter}px;background-color:white;color:${color};font-size:${fontSize}px;font-weight:bold;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid ${borderColor};box-shadow:${boxShadow};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;will-change:transform,box-shadow;transform:scale(${scale});transition:transform 0.45s cubic-bezier(.33,1,.68,1),box-shadow 0.45s, border-color 0.6s;`;
    const needsPulse = currentDelaySecs != null && Math.abs(currentDelaySecs) > 300;
    const pulseKeyframes = needsPulse ? `<style>@keyframes vehPulse{0%{box-shadow:0 0 3px rgba(0,0,0,.3);}50%{box-shadow:0 0 10px ${borderColor};}100%{box-shadow:0 0 3px rgba(0,0,0,.3);}}</style>` : '';
    const sideDelayLabelHtml = (currentDelaySecs != null)
        ? `${pulseKeyframes}<div style=\"position:absolute;top:50%;left:100%;transform:translate(6px,-50%);background:${delayClassColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 0 4px rgba(0,0,0,0.25);\">${formatDelayLabel(currentDelaySecs)}</div>`
        : '';
    const icon = useMemo(() => new L.DivIcon({
        html: `<div style='${styleStr}${needsPulse ? "animation:vehPulse 2s infinite;" : ''}'>${routeShortName || ""}${sideDelayLabelHtml}</div>`,
        className: "",
        iconSize: [diameter, diameter],
        iconAnchor: [diameter / 2, diameter / 2],
    }), [styleStr, diameter, routeShortName, sideDelayLabelHtml, needsPulse]);

    // Libellé détaillé pour le survol (avance/retard clair)
    const hoverDelayText = useMemo(() => {
        if (currentDelaySecs == null) return null;
        if (currentDelaySecs === 0) return "On time";
        const abs = Math.abs(currentDelaySecs);
        if (abs < 60) {
            return currentDelaySecs > 0 ? `Delay ${abs}s` : `Early ${abs}s`;
        }
        const mins = Math.round(abs / 60);
        return currentDelaySecs > 0 ? `Delay ${mins} min` : `Early ${mins} min`;
    }, [currentDelaySecs]);

    // Native tooltip on hover
    useEffect(() => {
        const marker = markerRef.current;
        if (!marker) return;
        try {
            if (hovered && hoverDelayText) {
                marker.unbindTooltip();
                const opts: TooltipOptions = {
                    direction: 'top',
                    offset: [0, -Math.ceil(diameter / 2)],
                    permanent: false,
                    sticky: true,
                    opacity: 1,
                    className: 'vehicle-delay-tooltip',
                };
                marker.bindTooltip(hoverDelayText, opts);
                marker.openTooltip();
            } else {
                marker.unbindTooltip();
            }
        } catch {}
        return () => {
            try { marker?.unbindTooltip(); } catch {}
        };
    }, [hovered, hoverDelayText, diameter]);

    return (
        <Marker
            ref={markerRef}
            position={position}
            icon={icon}
            interactive={!!onClick}
            eventHandlers={{
                click: (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                    e.originalEvent.stopPropagation();
                    if (onClick) onClick();
                },
                mouseover: handleMouseOver,
                mouseout: handleMouseOut,
            }}
            zIndexOffset={1000}
        >
            {/* Tooltip handle natively via bindTooltip/unbindTooltip */}
        </Marker>
    );
};

export default Vehicle;

