/**
 * ADC v2.3 filter verification bench: DETERMINISTIC SYNTHETIC ADC SIGNALS.
 * Not F28388D hardware data and not an electrical CLLC/PV plant simulation.
 * Mirrors the CCS filter update equation and sampling cadence.
 */
export const ADC_FILTER_CONFIG = Object.freeze({
  samplePeriodMs: 1,
  telemetryPeriodMs: 100,
  adcFullScaleCounts: 4096,
  adcMaxCount: 4095,
  adcVrefAssumedV: 3.3,
  viAlpha: 0.20,
  temperatureAlpha: 0.05,
  durationMs: 500,
  stepAtMs: 150,
});

export const ADC_FILTER_CHANNELS = Object.freeze([
  { key: 'vpv', pin: 'ADCA3', label: 'PV 입력전압', kind: 'vi', baseCount: 2900 },
  { key: 'ipv', pin: 'ADCA2', label: 'PV 입력전류', kind: 'vi', baseCount: 2020 },
  { key: 'vdc', pin: 'ADCD1', label: 'DC 출력전압', kind: 'vi', baseCount: 3150 },
  { key: 'idc', pin: 'ADCD0', label: 'DC 출력전류', kind: 'vi', baseCount: 1940 },
  { key: 'm1', pin: 'ADCA4', label: 'MOSFET 온도 1', kind: 'temperature', baseCount: 1900 },
  { key: 'm2', pin: 'ADCA5', label: 'MOSFET 온도 2', kind: 'temperature', baseCount: 1850 },
  { key: 'tr1', pin: 'ADCD2', label: '변압기 온도 1', kind: 'temperature', baseCount: 1980 },
  { key: 'tr2', pin: 'ADCD3', label: '변압기 온도 2', kind: 'temperature', baseCount: 2050 },
  { key: 'tr3', pin: 'ADCD4', label: '변압기 온도 3', kind: 'temperature', baseCount: 2080 },
]);

export function clampAdcCount(value) {
  if (!Number.isFinite(value)) throw new TypeError('ADC count must be finite');
  return Math.max(0, Math.min(ADC_FILTER_CONFIG.adcMaxCount, Math.round(value)));
}

export function adcCountsToVoltage(count) {
  return (count * ADC_FILTER_CONFIG.adcVrefAssumedV) / ADC_FILTER_CONFIG.adcFullScaleCounts;
}

/** Initialize on the first valid sample; do not introduce a false ramp from zero. */
export function emaStep(previous, input, alpha) {
  if (!Number.isFinite(input)) throw new TypeError('Invalid ADC input');
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new RangeError('Invalid alpha');
  return previous === null ? input : previous + alpha * (input - previous);
}

/**
 * Returns one value per 1 ms, plus a 100 ms subset of the *filtered* values.
 * Synthetic input is generated at 1 ms, unlike the existing 1 Hz browser demo.
 * No claims about source impedance, switching-ripple aliasing or real timing.
 */
export function simulateAdcFilterLab({
  channel = 'vpv',
  scenario = 'step',
  noiseCounts = 30,
  durationMs = ADC_FILTER_CONFIG.durationMs,
  alphaOverride = null,
} = {}) {
  const spec = ADC_FILTER_CHANNELS.find((item) => item.key === channel);
  if (!spec) throw new RangeError('Unknown ADC channel');
  if (!['steady', 'step', 'pulse'].includes(scenario)) throw new RangeError('Unknown scenario');
  if (!Number.isFinite(noiseCounts) || noiseCounts < 0 || noiseCounts > 200) throw new RangeError('Noise out of range');
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 5000) throw new RangeError('Invalid duration');
  const alpha = alphaOverride ?? (spec.kind === 'temperature' ? ADC_FILTER_CONFIG.temperatureAlpha : ADC_FILTER_CONFIG.viAlpha);
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new RangeError('Invalid alpha');

  const samples = [];
  const telemetry = [];
  let filtered = null;
  let first = null;
  let sumAbsoluteError = 0;
  let peakError = 0;
  for (let ms = 0; ms <= durationMs; ms += ADC_FILTER_CONFIG.samplePeriodMs) {
    const step = scenario === 'step' && ms >= ADC_FILTER_CONFIG.stepAtMs ? 340
      : scenario === 'pulse' && ms >= ADC_FILTER_CONFIG.stepAtMs && ms < ADC_FILTER_CONFIG.stepAtMs + 35 ? 540 : 0;
    // Deterministic, reproducible bench excitation only; not sampled MCU hardware noise.
    const noise = noiseCounts * (
      0.62 * Math.sin(ms * 2.17 + 0.18) +
      0.26 * Math.sin(ms * 0.51 + 2.3) +
      0.12 * Math.sin(ms * 3.41 + 0.8)
    );
    const count = clampAdcCount(spec.baseCount + step + noise);
    const rawV = adcCountsToVoltage(count);
    filtered = emaStep(filtered, rawV, alpha);
    if (first === null) first = filtered;
    const item = { ms, count, rawV, filteredV: filtered };
    samples.push(item);
    sumAbsoluteError += Math.abs(filtered - rawV);
    peakError = Math.max(peakError, Math.abs(filtered - rawV));
    // Firmware's first publication is after 100 timer ticks, not at t=0.
    if (ms > 0 && ms % ADC_FILTER_CONFIG.telemetryPeriodMs === 0) {
      telemetry.push({ ...item });
    }
  }
  return {
    spec, alpha, scenario, noiseCounts, samples, telemetry,
    firstFilteredV: first,
    last: samples[samples.length - 1],
    meanAbsDifferenceV: sumAbsoluteError / samples.length,
    peakDifferenceV: peakError,
  };
}
