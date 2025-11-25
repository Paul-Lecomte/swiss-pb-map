// TODO: use the percentage of trip completed to be realtime accurate
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

// Interface locale pour les options de tooltip
interface LeafletTooltipOptions {
    direction?: string;
    offset?: [number, number];
    permanent?: boolean;
    sticky?: boolean;
    opacity?: number;
    className?: string;
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
        const originalStopTimesSec: (number | null)[] = [];
        const adjustedStopTimesSec: (number | null)[] = [];
        const rtMap = new Map<number, RealtimeStopTimeUpdate>();
        (realtimeStopTimeUpdates || []).forEach(up => { rtMap.set(up.stopSequence, up); });
        for (const s of (stopTimes || [])) {
            const baseTimeStr = s.departure_time || s.arrival_time || undefined;
            const baseSecs = parseGtfsTime(baseTimeStr);
            originalStopTimesSec.push(baseSecs);
            let adjustedSecs = baseSecs;
            if (typeof s.stop_sequence === 'number') {
                const rt = rtMap.get(s.stop_sequence);
                if (rt) {
                    const realSecs = rt.departureTimeSecs ?? rt.arrivalTimeSecs;
                    if (realSecs != null) adjustedSecs = realSecs; else {
                        const depDelay = rt.departureDelaySecs;
                        const arrDelay = rt.arrivalDelaySecs;
                        if (depDelay != null && adjustedSecs != null) adjustedSecs = adjustedSecs + depDelay;
                        else if (arrDelay != null && adjustedSecs != null) adjustedSecs = adjustedSecs + arrDelay;
                    }
                }
            }
            adjustedStopTimesSec.push(adjustedSecs);
            const lat = Number(s.stop_lat);
            const lon = Number(s.stop_lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) { prelimStopIndices.push(-1); continue; }
            let bestIdx = -1; let bestD = Infinity;
            for (let i = 0; i < coords.length; i++) { const d = dist2(coords[i], [lat, lon]); if (d < bestD) { bestD = d; bestIdx = i; } }
            prelimStopIndices.push(bestIdx);
        }
        const firstValidIdx = prelimStopIndices.find(idx => idx >= 0);
        const lastValidIdx = [...prelimStopIndices].reverse().find(idx => idx >= 0);
        const isReversedGeom = typeof firstValidIdx === 'number' && typeof lastValidIdx === 'number' && firstValidIdx > lastValidIdx;
        let stopIndices: number[];
        if (isReversedGeom) {
            const n = coords.length; coords = [...coords].reverse();
            stopIndices = prelimStopIndices.map(idx => (idx >= 0 ? (n - 1 - idx) : -1));
        } else stopIndices = prelimStopIndices;
        type Seg = { startIdx: number; endIdx: number; startSec: number; endSec: number };
        const originalSegments: Seg[] = [];
        for (let i = 0; i < stopIndices.length - 1; i++) {
            let a = stopIndices[i]; let b = stopIndices[i+1];
            const as = originalStopTimesSec[i]; const bs = originalStopTimesSec[i+1];
            if (a >= 0 && b >= 0 && as != null && bs != null && bs >= as) { if (a > b) [a,b] = [b,a]; if (a !== b) originalSegments.push({ startIdx:a, endIdx:b, startSec:as as number, endSec:bs as number }); }
        }
        const cumDistArr: number[] = [0];
        for (let i = 1; i < coords.length; i++) { const A=coords[i-1]; const B=coords[i]; const dx=A[0]-B[0]; const dy=A[1]-B[1]; cumDistArr[i]=cumDistArr[i-1]+Math.sqrt(dx*dx+dy*dy); }
        const cumDist = new Float32Array(cumDistArr);
        return { coords, stopIndices, originalStopTimesSec, adjustedStopTimesSec, originalSegments, cumDist };
    }, [coordinates, stopTimes, realtimeStopTimeUpdates]);

    const computePositionForSeconds = useCallback((secondsNow: number): LatLngTuple | null => {
        const c = cache;
        const segments = c.originalSegments; // utiliser segments basés sur horaires originaux pour mouvement continu
        if (!c || !segments || segments.length === 0) { if (c.coords && c.coords.length) return c.coords[0]; return null; }
        let seg: typeof segments[0] | null = null;
        for (const s of segments) { if (secondsNow >= s.startSec && secondsNow <= s.endSec) { seg = s; break; } }
        if (!seg) {
            const first = segments[0]; const last = segments[segments.length - 1];
            if (secondsNow < first.startSec) return c.coords[first.startIdx];
            if (secondsNow > last.endSec) return c.coords[last.endIdx];
            // fallback: nearest segment based on time midpoint
            let best = segments[0]; let bestScore = Infinity;
            for (const s of segments) { const mid = (s.startSec + s.endSec)/2; const d = Math.abs(secondsNow - mid); if (d < bestScore) { bestScore = d; best = s; } }
            seg = best;
        }
        const { startIdx, endIdx, startSec, endSec } = seg;
        const span = Math.max(1, endSec - startSec);
        const frac = (secondsNow - startSec) / span;
        const cum = c.cumDist;
        const segStartDist = cum[startIdx] ?? 0; const segEndDist = cum[endIdx] ?? segStartDist + 1;
        const targetDist = segStartDist + (segEndDist - segStartDist) * frac;
        let i = startIdx; while (i < endIdx && cum[i+1] < targetDist) i++;
        const d0 = cum[i]; const d1 = cum[i+1] ?? d0 + 1; const localFrac = (targetDist - d0) / Math.max(1e-6, (d1 - d0));
        const a = c.coords[i]; const b = c.coords[i+1] ?? a;
        return [a[0] + (b[0]-a[0]) * localFrac, a[1] + (b[1]-a[1]) * localFrac];
    }, [cache]);

    const firstNonNull = cache.originalStopTimesSec.find(t => t != null) ?? null;
    const lastNonNull = [...cache.originalStopTimesSec].reverse().find(t => t != null) ?? null;

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

    // Adaptation anti-snap lors de mise à jour des stopTimeUpdates passés
    const adaptationActiveRef = useRef(false);
    const adaptationStartRef = useRef<number>(0);
    const lastRtSignatureRef = useRef<string | null>(null);

    // Détection de changement des mises à jour temps réel (signature)
    useEffect(() => {
        const sig = realtimeStopTimeUpdates ? JSON.stringify([...realtimeStopTimeUpdates].sort((a,b)=>a.stopSequence-b.stopSequence).map(u => ({
            s: u.stopSequence,
            aS: u.arrivalTimeSecs,
            dS: u.departureTimeSecs,
            aD: u.arrivalDelaySecs,
            dD: u.departureDelaySecs
        }))) : null;
        if (sig !== lastRtSignatureRef.current) {
            // Activation adaptation pour transition douce si changements sur des arrêts passés
            adaptationActiveRef.current = true;
            adaptationStartRef.current = performance.now();
            lastRtSignatureRef.current = sig;
        }
    }, [realtimeStopTimeUpdates]);

    // Helper pour approx distance cumulée d'une position affichée (projection simplifiée)
    const approximateDistanceOnPath = useCallback((pos: LatLngTuple | null): number | null => {
        const c = cache;
        if (!pos || !c.coords.length) return null;
        const coords = c.coords;
        const cum = c.cumDist;
        let bestI = 0; let bestD2 = Infinity;
        for (let i = 0; i < coords.length; i++) {
            const dx = coords[i][0] - pos[0];
            const dy = coords[i][1] - pos[1];
            const d2 = dx*dx + dy*dy;
            if (d2 < bestD2) { bestD2 = d2; bestI = i; }
        }
        return cum[bestI] ?? 0;
    }, [cache]);

    const positionAtDistance = useCallback((distTarget: number): LatLngTuple | null => {
        const c = cache;
        if (!c.coords.length) return null;
        const cum = c.cumDist;
        if (distTarget <= cum[0]) return c.coords[0];
        const lastIdx = c.coords.length - 1;
        if (distTarget >= cum[lastIdx]) return c.coords[lastIdx];
        let i = 0;
        while (i < lastIdx && cum[i+1] < distTarget) i++;
        const d0 = cum[i];
        const d1 = cum[i+1];
        const f = (distTarget - d0) / Math.max(1e-9, (d1 - d0));
        const a = c.coords[i];
        const b = c.coords[i+1];
        return [a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f];
    }, [cache]);

    useEffect(() => {
        // Register global animation callback instead of per-component RAF loop
        const update = () => {
            const now = new Date();
            const secondsNowFloat = getEffectiveNowSecHighRes(now);
            let interpSeconds = secondsNowFloat;
            if (currentDelaySecs != null) interpSeconds = secondsNowFloat - currentDelaySecs;
            if (firstNonNull != null && lastNonNull != null && lastNonNull > firstNonNull) {
                // Clamp pour éviter freeze en cas de retard extrême
                if (interpSeconds < firstNonNull) interpSeconds = firstNonNull;
                else if (interpSeconds > lastNonNull) interpSeconds = lastNonNull;
            }
            const rawTarget = computePositionForSeconds(interpSeconds);
            if (!rawTarget) return;
            let target = rawTarget;

            // Adaptation anti-snap: si mise à jour récente et déplacement brutal arrière ou avant
            if (adaptationActiveRef.current) {
                const elapsed = performance.now() - adaptationStartRef.current;
                const currentPos = displayedPosRef.current;
                const currentDist = approximateDistanceOnPath(currentPos);
                const targetDist = approximateDistanceOnPath(rawTarget);
                if (currentPos && currentDist != null && targetDist != null) {
                    const distDelta = targetDist - currentDist;
                    const maxBackward = - (cache.cumDist[cache.cumDist.length-1] * 0.02);
                    const maxForward = (cache.cumDist[cache.cumDist.length-1] * 0.04);
                    let clampedDelta = distDelta;
                    if (distDelta < maxBackward) clampedDelta = maxBackward;
                    if (distDelta > maxForward) clampedDelta = maxForward;
                    const adjustedDist = currentDist + clampedDelta;
                    target = positionAtDistance(adjustedDist) || rawTarget;
                }
                const spatialD2 = currentPos ? ((currentPos[0]-rawTarget[0])**2 + (currentPos[1]-rawTarget[1])**2) : 0;
                if (elapsed > 5000 || spatialD2 < 1e-12) {
                    adaptationActiveRef.current = false;
                }
            }

            const current = displayedPosRef.current;
            if (!current) {
                displayedPosRef.current = target;
                if (markerRef.current) markerRef.current.setLatLng(target); else setPosition(target);
                return;
            }
            // Smoothing dynamique (plus doux si adaptation active)
            const smoothingBase = 0.18;
            const smoothing = adaptationActiveRef.current ? smoothingBase * 0.35 : smoothingBase;
            const newLat = current[0] + (target[0] - current[0]) * smoothing;
            const newLon = current[1] + (target[1] - current[1]) * smoothing;
            const newPos: LatLngTuple = [newLat, newLon];
            displayedPosRef.current = newPos;
            if (markerRef.current) markerRef.current.setLatLng(newPos); else setPosition(newPos);
        };
        animationSubscribers.add(update);
        startGlobalAnimation();
        return () => { animationSubscribers.delete(update); };
    }, [computePositionForSeconds, getEffectiveNowSecHighRes, approximateDistanceOnPath, positionAtDistance, cache, currentDelaySecs, firstNonNull, lastNonNull]);

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

    // Progression du trajet (ratio 0-1)
    const tripProgressPct = useMemo(() => {
        if (firstNonNull == null || lastNonNull == null) return 0;
        const now = getEffectiveNowSecHighRes(new Date());
        const span = lastNonNull - firstNonNull;
        if (span <= 0) return 0;
        return Math.min(1, Math.max(0, (now - firstNonNull) / span));
    }, [firstNonNull, lastNonNull, getEffectiveNowSecHighRes]);

    // Progression "réelle" basée sur les horaires ajustés (retards) pour comparer avec la progression théorique
    const realProgressPct = useMemo(() => {
        const adjusted = cache.adjustedStopTimesSec;
        if (!adjusted || !adjusted.length) return tripProgressPct;
        const firstAdj = adjusted.find(t => t != null) ?? null;
        const lastAdj = [...adjusted].reverse().find(t => t != null) ?? null;
        if (firstAdj == null || lastAdj == null || lastAdj <= firstAdj) return tripProgressPct;
        const now = getEffectiveNowSecHighRes(new Date());
        return Math.min(1, Math.max(0, (now - firstAdj) / (lastAdj - firstAdj)));
    }, [cache.adjustedStopTimesSec, getEffectiveNowSecHighRes, tripProgressPct]);

    // Libellé détaillé pour le survol (version moderne, sobre)
    const hoverTooltipHtml = useMemo(() => {
        const baseFont = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
        const nowSecFloat = getEffectiveNowSecHighRes(new Date());
        // Détermination arrêt précédent / suivant sur base ajustée (plus pertinent en retard)
        const timesForPrevNext = cache.adjustedStopTimesSec;
        let prevIdx: number | null = null;
        let nextIdx: number | null = null;
        for (let i = 0; i < timesForPrevNext.length; i++) {
            const t = timesForPrevNext[i];
            if (t != null && t <= nowSecFloat) prevIdx = i;
            if (t != null && t > nowSecFloat) { nextIdx = i; break; }
        }
        const rtDelayMap = new Map<number, number>();
        (realtimeStopTimeUpdates || []).forEach(u => {
            const d = u.departureDelaySecs ?? u.arrivalDelaySecs;
            if (d != null) rtDelayMap.set(u.stopSequence, d);
        });
        const formatSecsHHMM = (sec: number | null) => {
            if (sec == null) return '--:--';
            const m = Math.floor((sec / 60) % 60);
            const h = Math.floor(sec / 3600);
            const pad = (n: number) => String(n).padStart(2,'0');
            return `${pad(h)}:${pad(m)}`;
        };
        const stopInfoBlock = (idx: number | null, label: string) => {
            if (idx == null || !stopTimes[idx]) {
                return `<div class='flex flex-col gap-0.5'><div class='text-[11px] text-gray-400'>${label}</div><div class='text-xs text-gray-300 italic'>N/A</div></div>`;
            }
            const st = stopTimes[idx];
            const seq = st.stop_sequence ?? idx;
            const delay = rtDelayMap.get(seq) ?? null;
            const timeSec = timesForPrevNext[idx];
            const delayBadge = delay != null ? `<span class='ml-1 px-1.5 py-0.5 rounded bg-gray-800/80 text-white text-[10px] font-medium'>${delay>0?'+':'-'}${Math.abs(delay)>=60?Math.round(Math.abs(delay)/60)+'m':Math.abs(delay)+'s'}</span>` : '';
            return `<div class='flex flex-col gap-0.5'>
                <div class='text-[11px] text-gray-400'>${label}</div>
                <div class='text-xs font-medium text-gray-700 truncate'>${st.stop_id || 'Stop'}</div>
                <div class='flex items-center text-[11px] text-gray-500'>${formatSecsHHMM(timeSec)}${delayBadge}</div>
            </div>`;
        };
        // Helpers
        const formatBadge = (d: number | null) => {
            if (d == null) return '';
            return `${d > 0 ? '+' : '-'}${Math.abs(d) >= 60 ? Math.round(Math.abs(d) / 60) + 'm' : Math.abs(d) + 's'}`;
        };

        if (currentDelaySecs == null) {
            const accent = '#667C4A';
            const progressPlanned = (tripProgressPct||0)*100;
            const progressReal = (realProgressPct||0)*100;
            return `
                <div class="bg-white/95 backdrop-blur-sm border border-gray-200 shadow-sm rounded-xl p-3 w-[300px] text-sm" style="font-family: ${baseFont};">
                    <div class="flex items-center gap-3">
                        <div class="flex-none">
                            <div class="w-10 h-10 rounded-md grid place-items-center" style="background: ${accent}22;">
                                <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="${accent}" stroke-width="1.5" fill="none" /><path d="M12 7.5v4l2 1" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                            </div>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <div class="truncate font-medium text-gray-800 text-sm">${routeShortName || 'Trip'}</div>
                                <div class="text-xs text-gray-400">On time</div>
                            </div>
                            <div class="mt-2">
                                ${dualProgressBars(accent, accent, progressPlanned, progressReal)}
                            </div>
                        </div>
                    </div>
                    <div class='mt-3 grid grid-cols-2 gap-3'>
                        ${stopInfoBlock(prevIdx, 'Previous')}
                        ${stopInfoBlock(nextIdx, 'Next')}
                    </div>
                </div>
            `;
        }

        const delay = currentDelaySecs;
        const abs = Math.abs(delay);
        const isLate = delay > 0;
        const badgeText = formatBadge(delay);
        const label = isLate ? `Delay ${badgeText}` : `Early ${badgeText}`;

        const palette = (() => {
            if (isLate) {
                if (abs >= 600) return { main: '#b91c1c', soft: '#fee2e2' };
                if (abs >= 300) return { main: '#ef4444', soft: '#fee2e2' };
                return { main: '#f97316', soft: '#fff7ed' };
            }
            if (abs >= 600) return { main: '#1e3a8a', soft: '#eef2ff' };
            return { main: '#2563eb', soft: '#eef2ff' };
        })();
        const iconBg = palette.soft; // iconColor retiré car non utilisé
        const progressPlanned = (tripProgressPct||0)*100;
        const progressReal = (realProgressPct||0)*100;
        return `
            <div class="bg-white/95 backdrop-blur-sm border border-gray-200 shadow-sm rounded-xl p-3 w-[300px] text-sm" style="font-family: ${baseFont};">
                <div class="flex items-start gap-3">
                    <div class="flex-none">
                        <div class="w-10 h-10 rounded-md grid place-items-center" style="background: ${iconBg};">
                            <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="${palette.main}" stroke-width="1.5" fill="none" /><path d="M12 7.5v4l2 1" stroke="${palette.main}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2">
                            <div class="truncate font-medium text-gray-800 text-sm">${routeShortName || 'Trip'}</div>
                            <div class="flex items-center gap-2">
                                <div class="text-xs text-gray-400">${label}</div>
                                <div class="px-2 py-0.5 rounded-md text-xs font-semibold" style="background:${palette.main}; color: #fff; min-width:44px; text-align:center;">${badgeText}</div>
                            </div>
                        </div>
                        ${dualProgressBars(palette.soft, palette.main, progressPlanned, progressReal)}
                    </div>
                </div>
                <div class='mt-3 grid grid-cols-2 gap-3'>
                    ${stopInfoBlock(prevIdx, 'Previous')}
                    ${stopInfoBlock(nextIdx, 'Next')}
                </div>
            </div>
        `;
    }, [currentDelaySecs, routeShortName, tripProgressPct, realProgressPct, cache.adjustedStopTimesSec, stopTimes, realtimeStopTimeUpdates, getEffectiveNowSecHighRes]);

    // Native tooltip on hover (HTML)
    useEffect(() => {
        const marker = markerRef.current;
        if (!marker) return;
        try {
            if (hovered && hoverTooltipHtml) {
                marker.unbindTooltip();
                const opts: LeafletTooltipOptions = {
                    direction: 'top',
                    offset: [0, -Math.ceil(diameter / 2)],
                    permanent: false,
                    sticky: true,
                    opacity: 1,
                    className: 'vehicle-delay-tooltip',
                };
                marker.bindTooltip(hoverTooltipHtml, opts);
                marker.openTooltip();
            } else {
                marker.unbindTooltip();
            }
        } catch {}
        return () => { try { marker?.unbindTooltip(); } catch {} };
    }, [hovered, hoverTooltipHtml, diameter]);

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

// Générateur HTML pour double barre de progression (planned vs realtime)
const dualProgressBars = (plannedColor: string, realColor: string, plannedPct: number, realPct: number) => {
    const p = Math.max(0, Math.min(100, plannedPct));
    const r = Math.max(0, Math.min(100, realPct));
    return `
        <div class='flex flex-col gap-1'>
            <div class='flex items-center justify-between text-[11px] text-gray-500'>
                <span>Planned</span><span>${Math.round(p)}%</span>
            </div>
            <div class='h-1.5 bg-gray-100 rounded-full overflow-hidden'>
                <div class='h-full rounded-full' style='width:${p}%;background:${plannedColor};opacity:.85;transition:width .6s ease;'></div>
            </div>
            <div class='flex items-center justify-between text-[11px] text-gray-500 mt-1'>
                <span>Realtime</span><span>${Math.round(r)}%</span>
            </div>
            <div class='h-1.5 bg-gray-100 rounded-full overflow-hidden'>
                <div class='h-full rounded-full' style='width:${r}%;background:${realColor};transition:width .6s ease;'></div>
            </div>
        </div>`;
};

export default Vehicle;

