// Base URL configurable via NEXT_PUBLIC_API_BASE_URL (fallback to localhost)
const API_BASE_URL = (typeof process !== 'undefined' && (process as any).env && (process as any).env.NEXT_PUBLIC_API_BASE_URL)
  ? (process as any).env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '')
  : "http://localhost:3000/api";

export async function fetchRoutesInBbox(bbox: number[], zoom: number) {
    const bboxStr = bbox.join(",");
    const res = await fetch(`${API_BASE_URL}/routes/routes-in-bbox?bbox=${bboxStr}&zoom=${zoom}`);
    return res.json();
}

// Stream NDJSON features for routes in bbox. Calls onFeature for each feature received.
export async function streamRoutesInBbox(
  bbox: number[],
  zoom: number,
  onFeature: (feature: any) => void,
  opts?: {
    signal?: AbortSignal,
    knownIds?: string[],
    includeStatic?: boolean,
    compactTimes?: boolean,
    maxTrips?: number,
    decimals?: number,
    concurrency?: number,
    onlyNew?: boolean,
    onMeta?: (meta: any) => void,
    onEnd?: (summary: any) => void,
  }
): Promise<{ count: number }> {
  const bboxStr = bbox.join(',');
  const params = new URLSearchParams();
  params.set('bbox', bboxStr);
  params.set('zoom', String(zoom));
  params.set('stream', '1');
  if (opts?.knownIds && opts.knownIds.length) params.set('known', opts.knownIds.join(','));
  if (opts?.includeStatic !== undefined) params.set('include_static', opts.includeStatic ? '1' : '0');
  if (opts?.compactTimes !== undefined) params.set('compact_times', opts.compactTimes ? '1' : '0');
  if (opts?.maxTrips != null) params.set('max_trips', String(opts.maxTrips));
  if (opts?.decimals != null) params.set('decimals', String(opts.decimals));
  if (opts?.concurrency != null) params.set('concurrency', String(opts.concurrency));
  if (opts?.onlyNew != null) params.set('only_new', opts.onlyNew ? '1' : '0');
  const url = `${API_BASE_URL}/routes/routes-in-bbox?${params.toString()}`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/x-ndjson, application/json' },
    signal: opts?.signal,
  } as RequestInit);

  const contentType = res.headers.get('content-type') || '';
  if (!res.body || contentType.includes('application/json') && !contentType.includes('ndjson')) {
    const json = await res.json().catch(() => ({ type: 'FeatureCollection', features: [] }));
    const features = Array.isArray(json?.features) ? json.features : [];
    for (const f of features) onFeature(f);
    if (opts?.onEnd) opts.onEnd({ count: features.length, fallback: true });
    return { count: features.length };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let count = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          const obj = JSON.parse(line);
          if (obj && obj.type === 'Feature') {
            onFeature(obj);
            count += 1;
          } else if (obj && obj.meta) {
            if (opts?.onMeta) opts.onMeta(obj);
          } else if (obj && obj.end) {
            if (opts?.onEnd) opts.onEnd(obj);
          } else if (obj && obj.error) {
            // eslint-disable-next-line no-console
            console.error('[streamRoutesInBbox] error line', obj);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
            console.warn('[streamRoutesInBbox] invalid json line', line);
        }
      }
      idx = buffer.indexOf('\n');
    }
  }

  const last = buffer.trim();
  if (last) {
    try {
      const obj = JSON.parse(last);
      if (obj && obj.type === 'Feature') {
        onFeature(obj);
        count += 1;
      } else if (obj && obj.end) {
        if (opts?.onEnd) opts.onEnd(obj);
      }
    } catch {}
  }

  return { count };
}
