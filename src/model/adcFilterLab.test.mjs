import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADC_FILTER_CHANNELS, ADC_FILTER_CONFIG, simulateAdcFilterLab,
  emaStep, adcCountsToVoltage, clampAdcCount,
} from './adcFilterLab.js';

test('all nine pins are present without duplicates', () => {
  assert.equal(ADC_FILTER_CHANNELS.length, 9);
  assert.equal(new Set(ADC_FILTER_CHANNELS.map((s) => s.pin)).size, 9);
  assert.deepEqual(ADC_FILTER_CHANNELS.map((s) => s.pin),
    ['ADCA3','ADCA2','ADCD1','ADCD0','ADCA4','ADCA5','ADCD2','ADCD3','ADCD4']);
});
test('EMA follows the CCS formula and initializes with the first valid sample', () => {
  assert.equal(emaStep(null, 2, 0.2), 2);
  assert.equal(emaStep(2, 3, 0.2), 2.2);
  assert.equal(emaStep(2, 3, 0.05), 2.05);
});
test('ADC quantization uses 4096 levels with a 4095 count maximum', () => {
  assert.equal(clampAdcCount(7000), 4095);
  assert.equal(clampAdcCount(-10), 0);
  assert.equal(adcCountsToVoltage(0), 0);
  assert.ok(adcCountsToVoltage(4095) < 3.3);
});
test('1ms sampling and 100ms snapshot cadence are exact', () => {
  const r = simulateAdcFilterLab({ noiseCounts: 0 });
  assert.equal(r.samples.length, 501);
  assert.deepEqual(r.telemetry.map((s) => s.ms), [100,200,300,400,500]);
  assert.equal(r.samples[0].filteredV, r.samples[0].rawV);
});
test('steady no-noise remains constant without a false startup ramp', () => {
  const r = simulateAdcFilterLab({ scenario: 'steady', noiseCounts: 0 });
  assert.ok(r.samples.every((s) => s.rawV === r.samples[0].rawV));
  assert.ok(r.samples.every((s) => s.filteredV === r.samples[0].filteredV));
});
test('step response matches alpha 0.2 after first step', () => {
  const r = simulateAdcFilterLab({ scenario: 'step', noiseCounts: 0 });
  const prev = r.samples[149].filteredV;
  const x = r.samples[150].rawV;
  assert.ok(Math.abs(r.samples[150].filteredV - (prev + .2*(x-prev))) < 1e-12);
  assert.ok(r.samples[150].filteredV < x);
});
test('temperature alpha is 0.05; voltage alpha is 0.20', () => {
  assert.equal(simulateAdcFilterLab({channel:'m1'}).alpha, ADC_FILTER_CONFIG.temperatureAlpha);
  assert.equal(simulateAdcFilterLab({channel:'vpv'}).alpha, ADC_FILTER_CONFIG.viAlpha);
});
test('all signal samples remain in valid ADC range for every channel and scenario', () => {
  for (const s of ADC_FILTER_CHANNELS) for (const scenario of ['steady','step','pulse']) {
    const r = simulateAdcFilterLab({ channel:s.key, scenario, noiseCounts:100 });
    assert.ok(r.samples.every((p) => Number.isInteger(p.count) && p.count >= 0 && p.count <= 4095));
    assert.equal(r.telemetry.length, 5);
  }
});
test('bad settings fail closed', () => {
  assert.throws(()=>simulateAdcFilterLab({channel:'bad'}), /Unknown/);
  assert.throws(()=>simulateAdcFilterLab({noiseCounts:201}), /Noise/);
  assert.throws(()=>emaStep(0, 1, 0), /alpha/);
});
