interface FetchOpts { simplify?: number; includeStops?: boolean; maxTrips?: number }
interface Env { env?: { API_BASE_URL?: string } }
const maybeProc: Env | undefined = typeof process !== 'undefined' ? (process as unknown as Env) : undefined;
const API_BASE = maybeProc?.env?.API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000/api';

type Feature = { type: 'Feature'; geometry: any; properties: Record<string, any> };
const cache = new Map<string, { at: number; data: Feature }>();
const inflight = new Map<string, Promise<Feature>>();
const TTL = 10 * 60 * 1000;

function key(routeId: string, opts?: FetchOpts) {
  const s = opts?.simplify ?? 0;
  const st = opts?.includeStops === false ? 0 : 1;
  const mt = opts?.maxTrips ?? 500;
  return `${routeId}|s${s}|st${st}|mt${mt}`;
}

export async function getRouteGeometry(routeId: string, opts?: FetchOpts): Promise<Feature> {
  const k = key(routeId, opts);
  const c = cache.get(k);
  if (c && (Date.now() - c.at) < TTL) return c.data;
  if (inflight.has(k)) return inflight.get(k)!;
  const p = (async () => {
    const qs = new URLSearchParams();
    if (opts?.simplify != null) qs.set('simplify', String(opts.simplify));
    if (opts?.includeStops === false) qs.set('include_stops', '0');
    if (opts?.maxTrips != null) qs.set('max_trips', String(opts.maxTrips));
    const url = `${API_BASE}/routes/geometry/${encodeURIComponent(routeId)}${qs.toString() ? '?' + qs.toString() : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`geometry fetch failed: ${res.status}`);
    const json = await res.json();
    cache.set(k, { at: Date.now(), data: json });
    inflight.delete(k);
    return json as Feature;
  })();
  inflight.set(k, p);
  try { return await p; } catch (e) { inflight.delete(k); throw e; }
}

export function invalidateRouteGeometry(routeId: string) {
  const prefix = `${routeId}|`;
  for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) cache.delete(k);
}

export async function getRouteGeometryByTrip(tripId: string, opts?: FetchOpts): Promise<Feature> {
  const s = opts?.simplify ?? 0;
  const st = opts?.includeStops === false ? 0 : 1;
  const mt = opts?.maxTrips ?? 500;
  const k = `trip:${tripId}|s${s}|st${st}|mt${mt}`;
  const c = cache.get(k);
  if (c && (Date.now() - c.at) < TTL) return c.data;
  if (inflight.has(k)) return inflight.get(k)!;
  const p = (async () => {
    const qs = new URLSearchParams();
    if (opts?.simplify != null) qs.set('simplify', String(opts.simplify));
    if (opts?.includeStops === false) qs.set('include_stops', '0');
    if (opts?.maxTrips != null) qs.set('max_trips', String(opts.maxTrips));
    const url = `${API_BASE}/routes/geometry-by-trip/${encodeURIComponent(tripId)}${qs.toString() ? '?' + qs.toString() : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`geometry-by-trip fetch failed: ${res.status}`);
    const json = await res.json();
    cache.set(k, { at: Date.now(), data: json });
    inflight.delete(k);
    return json as Feature;
  })();
  inflight.set(k, p);
  try { return await p; } catch (e) { inflight.delete(k); throw e; }
}
