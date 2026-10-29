/**
 * First-order lumped cooling demonstrator.
 * T(t) = Ta + (T0 - Ta) exp(-t / tau)
 * tau is an editable illustrative assumption, NOT a board-calibrated constant.
 * Assumes heat generation is removed after t=0 and ambient temperature stays constant.
 */
export function firstOrderTemperature(initialC, ambientC, tauSeconds, elapsedSeconds) {
  if (![initialC, ambientC, tauSeconds, elapsedSeconds].every(Number.isFinite) ||
      tauSeconds <= 0 || elapsedSeconds < 0) return null;
  return ambientC + (initialC - ambientC) * Math.exp(-elapsedSeconds / tauSeconds);
}

/** First time a temperature at or above target cools down to target.
 * null = not reachable during this idealized passive-cooling process.
 */
export function coolingTimeToTarget(initialC, ambientC, tauSeconds, targetC) {
  if (![initialC, ambientC, tauSeconds, targetC].every(Number.isFinite) || tauSeconds <= 0) return null;
  if (initialC <= targetC) return 0;
  if (initialC <= ambientC || targetC <= ambientC) return null;
  return tauSeconds * Math.log((initialC - ambientC) / (targetC - ambientC));
}

export function buildCoolingSeries(initialC, ambientC, tauSeconds, durationSeconds, stepSeconds = 10) {
  if (![initialC, ambientC, tauSeconds, durationSeconds, stepSeconds].every(Number.isFinite) ||
      tauSeconds <= 0 || durationSeconds < 0 || stepSeconds <= 0 || durationSeconds / stepSeconds > 1000) {
    return [];
  }
  const samples = [];
  for (let t = 0; t < durationSeconds; t += stepSeconds) {
    samples.push({ elapsedSeconds: t, temperatureC: firstOrderTemperature(initialC, ambientC, tauSeconds, t) });
  }
  samples.push({ elapsedSeconds: durationSeconds, temperatureC: firstOrderTemperature(initialC, ambientC, tauSeconds, durationSeconds) });
  return samples;
}
