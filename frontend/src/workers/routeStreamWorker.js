// Route streaming worker
// Receives: { cmd: 'stream', apiBase, bbox, zoom, knownIds, includeStatic, maxTrips, concurrency, onlyNew }
// Sends: { type: 'meta', data }, { type: 'features', features: [...] }, { type: 'end', data }, { type: 'error', message }

self.addEventListener('message', async (evt) => {
  const msg = evt.data;
  if (!msg || msg.cmd !== 'stream') return;
  const {
    apiBase,
    bbox,
    zoom,
    knownIds = [],
    includeStatic = true,
    maxTrips = 50,
    concurrency = 10,
    onlyNew = true,
    stream = true,
    batchSize = 25,
    batchMs = 200,
    maxRoutes = 100,
  } = msg;

  if (!apiBase) {
    self.postMessage({ type: 'error', message: 'API_BASE_URL manquant (apiBase)' });
    return;
  }

  let aborted = false;
  const abortController = new AbortController();

  const onAbort = () => {
    aborted = true;
    try { abortController.abort(); } catch {}
  };
  self.addEventListener('message', function abortListener(ev2) {
    if (ev2.data && ev2.data.cmd === 'abort' && ev2.data.token === msg.token) {
      onAbort();
      self.removeEventListener('message', abortListener);
    }
  });

  try {
    const bboxStr = bbox.join(',');
    const params = new URLSearchParams();
    params.set('bbox', bboxStr);
    params.set('zoom', String(zoom));
    if (stream) params.set('stream', '1');
    if (knownIds.length) params.set('known', knownIds.join(','));
    params.set('include_static', includeStatic ? '1' : '0');
    params.set('max_trips', String(maxTrips));
    params.set('concurrency', String(concurrency));
    params.set('only_new', onlyNew ? '1' : '0');
    params.set('max_routes', String(maxRoutes));
    const url = `${apiBase.replace(/\/$/, '')}/routes/routes-in-bbox?${params.toString()}`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/x-ndjson, application/json' },
      signal: abortController.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.body || (contentType.includes('application/json') && !contentType.includes('ndjson'))) {
      const json = await res.json().catch(() => ({ type: 'FeatureCollection', features: [] }));
      const features = Array.isArray(json?.features) ? json.features : [];
      self.postMessage({ type: 'features', features });
      self.postMessage({ type: 'end', data: { count: features.length, fallback: true } });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let batch = [];
    let lastFlush = Date.now();
    let totalCount = 0;

    const flush = (force = false) => {
      if (batch.length === 0) return;
      if (!force && batch.length < batchSize && (Date.now() - lastFlush) < batchMs) return;
      self.postMessage({ type: 'features', features: batch });
      batch = [];
      lastFlush = Date.now();
    };

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
            if (obj && obj.meta) {
              self.postMessage({ type: 'meta', data: obj });
            } else if (obj && obj.type === 'Feature') {
              batch.push(obj);
              totalCount += 1;
              flush();
            } else if (obj && obj.end) {
              flush(true);
              self.postMessage({ type: 'end', data: obj });
            } else if (obj && obj.error) {
              self.postMessage({ type: 'error', message: obj.message || 'route error' });
            }
          } catch {
            // ignore malformed line
          }
        }
        idx = buffer.indexOf('\n');
      }
    }
    flush(true);
    if (!aborted) self.postMessage({ type: 'end', data: { count: totalCount } });
  } catch (e) {
    if (!aborted) self.postMessage({ type: 'error', message: (e && e.message) || 'stream failed' });
  }
});
