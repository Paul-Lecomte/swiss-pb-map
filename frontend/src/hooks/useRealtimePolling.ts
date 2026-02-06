import { useEffect, useRef, useState } from 'react';

interface Vehicle {
  trip_id: string;
  position: [number, number];
  progress: number;
  prev_stop_id?: string;
  next_stop_id?: string;
  delaySeconds: number;
}

interface RouteFeatureProperties {
  route_id: string;
  route_short_name?: string;
  delayMinutes?: number;
  vehicles?: Vehicle[];
  isRealtime?: boolean;
  fetchedAt?: string;
}

interface RouteFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: RouteFeatureProperties;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
  meta?: { fetchedAt?: string; isRealtime?: boolean };
}

export function useRealtimePolling(bbox: number[] | null, intervalMs = 12000) {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [prevData, setPrevData] = useState<FeatureCollection | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastBboxRef = useRef<string | null>(null);

  const base_url = process.env.API_BASE_URL

  // Debounced bbox string
  const bboxStr = bbox ? bbox.join(',') : null;

  useEffect(() => {
    function fetchData() {
      if (!bboxStr) return;
      fetch(base_url + `/realtime/interpolated?bbox=${bboxStr}`)
        .then(r => r.json())
        .then(fc => {
          setPrevData(data);
          setData(fc);
        })
        .catch(err => console.error('[Realtime] fetch error', err));
    }

    // If bbox changed significantly, immediate fetch
    if (bboxStr && bboxStr !== lastBboxRef.current) {
      lastBboxRef.current = bboxStr;
      fetchData();
    }

    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(fetchData, intervalMs);

    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [bboxStr, intervalMs]);

  return { current: data, previous: prevData };
}

