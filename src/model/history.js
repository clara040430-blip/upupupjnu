/**
 * PV-CLLC manual signal-injection HISTORY (not a CLLC plant simulation).
 * Stores only values accepted by the existing nominal ADC conversion model.
 * No fake samples, smoothing, interpolation, or hardware-state inference.
 */
export const HISTORY_KEYS = Object.freeze([
  'vpv', 'ipv', 'vdc', 'idc', 'tr1', 'tr2', 'tr3', 'm1', 'm2',
]);

export const HISTORY_GROUPS = Object.freeze([
  Object.freeze({
    id: 'voltage', title: '전압', unit: 'V', keys: Object.freeze(['vpv', 'vdc']),
  }),
  Object.freeze({
    id: 'current', title: '전류', unit: 'A', keys: Object.freeze(['ipv', 'idc']),
  }),
  Object.freeze({
    id: 'temperature', title: '온도', unit: '°C',
    keys: Object.freeze(['tr1', 'tr2', 'tr3', 'm1', 'm2']),
  }),
]);

/** Accepts only nominally converted, finite sensor readings. */
export function getUsableValue(report, key) {
  if (!report || typeof report !== 'object') return null;
  if (report.quality?.[key] !== 'NOMINAL_UNCALIBRATED') return null;
  const value = report.values?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Append one timestamped reading per available board. Missing and invalid
 * channels remain null. Previous data is not mutated; bounded per-board memory.
 */
export function appendBoardSamples(previous, reports, boardIds, timestampMs, limit = 180) {
  if (!Number.isFinite(timestampMs)) throw new TypeError('Invalid timestamp');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid history limit');

  const next = { ...previous };
  for (const id of boardIds) {
    const existing = Array.isArray(previous?.[id]) ? previous[id] : [];
    const report = reports?.[id];
    if (!report || typeof report !== 'object' || !report.values) {
      next[id] = existing;
      continue;
    }
    const values = Object.fromEntries(
      HISTORY_KEYS.map((key) => [key, getUsableValue(report, key)])
    );
    const sample = { at: timestampMs, values };
    next[id] = [...existing, sample].slice(-limit);
  }
  return next;
}

/** Separate missing samples and long pauses rather than drawing false lines. */
export function splitValidSegments(samples, key, maxGapMs = 2500) {
  const segments = [];
  let current = [];
  let lastAt = null;

  function flush() {
    if (current.length) segments.push(current);
    current = [];
    lastAt = null;
  }

  for (const sample of samples ?? []) {
    const value = sample?.values?.[key];
    const at = sample?.at;
    if (!Number.isFinite(value) || !Number.isFinite(at)) {
      flush();
      continue;
    }
    if (lastAt !== null && (at <= lastAt || at - lastAt > maxGapMs)) {
      flush();
    }
    current.push({ at, value });
    lastAt = at;
  }
  flush();
  return segments;
}

/** Compute a readable range without inventing values for missing sensors. */
export function findValueRange(samples, keys) {
  const observed = [];
  for (const sample of samples ?? []) {
    for (const key of keys) {
      const value = sample?.values?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) observed.push(value);
    }
  }
  if (observed.length === 0) return null;
  const min = Math.min(...observed);
  const max = Math.max(...observed);
  const pad = Math.max((max - min) * 0.1, Math.abs(max || min) * 0.02, 0.1);
  return { min: min - pad, max: max + pad };
}
