import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENSOR_INPUT_DEFAULTS,
  idealAdcPinVoltage,
  simulateAdcInjection,
} from './adcInjection.js';
import { SENSOR_SPEC, ADC_SPEC } from '../model/sensorConversion.js';
const polarity = { ipv: 1, idc: 1 };
const close = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} must be within ${tolerance} of ${expected}`);

test('all nine physical ADC channels are mapped', () => {
  assert.equal(Object.keys(SENSOR_SPEC).length, 9);
  assert.equal(SENSOR_SPEC.vpv.adcInput, 'ADCA3');
  assert.equal(SENSOR_SPEC.idc.adcInput, 'ADCD0');
  assert.equal(SENSOR_SPEC.tr3.adcInput, 'ADCD4');
});
test('nominal voltage sensor amplification and quantization', () => {
  const result = simulateAdcInjection({ vpv: 32, vdc: 45 });
  close(result.idealPinVoltageV.vpv, 32 * 0.078, 1e-12);
  close(result.values.vpv, 32, 0.015);
  close(result.values.vdc, 45, 0.015);
  assert.equal(result.quality.vpv, 'NOMINAL_UNCALIBRATED');
});
test('current sign must be intentionally selected for the test', () => {
  const result = simulateAdcInjection({ ipv: 20, idc: 12 });
  assert.equal(result.values.ipv, null);
  assert.equal(result.quality.ipv, 'CURRENT_POLARITY_UNCONFIRMED');
  assert.equal(result.rawBySensor.ipv, undefined);
});
test('positive and negative current polarity assumptions are reversible', () => {
  for (const sign of [1, -1]) {
    const response = simulateAdcInjection({ ipv: 20, idc: -10 },
      { currentPolarity: { ipv: sign, idc: sign } });
    close(response.values.ipv, 20, 0.02);
    close(response.values.idc, -10, 0.02);
  }
});
test('NTC forward model agrees with 25 C divider at 10 kOhm', () => {
  const sense = idealAdcPinVoltage('tr1', 25);
  close(sense.voltageV, 3.3 * 1500 / 11500, 1e-9);
  const response = simulateAdcInjection({ tr1: 25, m1: 25 });
  close(response.values.tr1, 25, 0.2);
  close(response.values.m1, 25, 0.2);
});
test('all five NTC channels roundtrip at 100 C and 125 C', () => {
  for (const key of ['tr1', 'tr2', 'tr3', 'm1', 'm2']) {
    for (const temp of [100, 125]) {
      const response = simulateAdcInjection({ [key]: temp });
      close(response.values[key], temp, 0.7);
    }
  }
});
test('too-high voltage causes ADC clipping and rail quality', () => {
  const result = simulateAdcInjection({ vpv: 80 });
  assert.equal(result.rawBySensor.vpv, ADC_SPEC.maxCount);
  assert.equal(result.quality.vpv, 'ADC_INPUT_CLIPPED');
  assert.equal(result.values.vpv, null);
});
test('negative pin voltage clips at 0 and marks current as clipped', () => {
  const result = simulateAdcInjection({ ipv: -80 },
    { currentPolarity: polarity });
  assert.equal(result.rawBySensor.ipv, 0);
  assert.equal(result.quality.ipv, 'ADC_INPUT_CLIPPED');
  assert.equal(result.values.ipv, null);
});
test('0 V input uses ADC count 0 with nominal converter', () => {
  const result = simulateAdcInjection({ vpv: 0 });
  assert.equal(result.rawBySensor.vpv, 0);
  assert.equal(result.values.vpv, 0);
});
test('invalid input and temperature below absolute zero are rejected', () => {
  const result = simulateAdcInjection({ vpv: NaN, tr1: -300 });
  assert.equal(result.quality.vpv, 'INVALID_INPUT');
  assert.equal(result.quality.tr1, 'INVALID_TEMPERATURE');
  assert.equal(result.values.tr1, null);
});
test('missing data are never fabricated', () => {
  const result = simulateAdcInjection({ vpv: 12 });
  assert.equal(result.quality.idc, 'NOT_PROVIDED');
  assert.equal(result.values.idc, null);
});
test('default conditions cover all nine sensor fields', () => {
  assert.deepEqual(Object.keys(SENSOR_INPUT_DEFAULTS).sort(),
    Object.keys(SENSOR_SPEC).sort());
  const result = simulateAdcInjection(SENSOR_INPUT_DEFAULTS, { currentPolarity: polarity });
  for (const key of Object.keys(SENSOR_SPEC)) {
    assert.ok(Number.isFinite(result.values[key]), key);
  }
});
