import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADC_SPEC,
  NOMINAL_SENSING,
  SENSOR_SPEC,
  adcCountToVolts,
  ntcVoltsToCelsius,
  convertAdcMeasurements,
} from './sensorConversion.js';

const countForVoltage = (volts) =>
  Math.round(volts / ADC_SPEC.referenceVoltageV * ADC_SPEC.codeLevels);

const closeTo = (actual, expected, tolerance) => {
  assert.ok(actual !== null && Number.isFinite(actual), `not a finite number: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test('nine physical ADC channels are distinct', () => {
  const channels = Object.values(SENSOR_SPEC).map((spec) => spec.adcInput);
  assert.equal(channels.length, 9);
  assert.equal(new Set(channels).size, 9);
});

test('12-bit ADC conversion and invalid counts', () => {
  assert.equal(adcCountToVolts(0), 0);
  assert.equal(adcCountToVolts(4095), 4095 * 3.3 / 4096);
  assert.ok(adcCountToVolts(4095) < 3.3); // 4096 quantization levels, 0..4095 codes
  closeTo(adcCountToVolts(2048), 1.65, 0.001);
  for (const bad of [-1, 4096, 1.5, Number.NaN, Infinity, undefined, '100']) {
    assert.equal(adcCountToVolts(bad), null);
  }
});

test('nominal Vpv and Vdc conversion', () => {
  const vpvV = 30;
  const vdcV = 45;
  const r = convertAdcMeasurements({
    vpv: countForVoltage(vpvV * SENSOR_SPEC.vpv.voltsPerUnit),
    vdc: countForVoltage(vdcV * SENSOR_SPEC.vdc.voltsPerUnit),
  });
  closeTo(r.values.vpv, vpvV, 0.01);
  closeTo(r.values.vdc, vdcV, 0.01);
  assert.equal(r.quality.vpv, 'NOMINAL_UNCALIBRATED');
  assert.equal(r.quality.idc, 'NOT_PROVIDED');
});

test('signed current is not guessed without polarity confirmation', () => {
  const count = countForVoltage(1.65 + 20 * SENSOR_SPEC.ipv.voltsPerUnit);
  const r = convertAdcMeasurements({ ipv: count });
  assert.equal(r.values.ipv, null);
  assert.equal(r.quality.ipv, 'CURRENT_DIRECTION_UNCONFIRMED');

  const positive = convertAdcMeasurements({ ipv: count }, { currentPolarity: { ipv: 1 } });
  const negative = convertAdcMeasurements({ ipv: count }, { currentPolarity: { ipv: -1 } });
  closeTo(positive.values.ipv, 20, 0.02);
  closeTo(negative.values.ipv, -20, 0.02);
});

test('25 degree NTC anchor and approximate 100 degree NTC', () => {
  const v25 = NOMINAL_SENSING.ntcSupplyVoltageV *
    NOMINAL_SENSING.ntcBottomResistorOhm /
    (NOMINAL_SENSING.ntcNominalResistanceOhm + NOMINAL_SENSING.ntcBottomResistorOhm);
  closeTo(ntcVoltsToCelsius(v25, 3988), 25, 1e-9);
  const r = convertAdcMeasurements({
    tr1: countForVoltage(v25),
    m1: countForVoltage(v25),
  });
  closeTo(r.values.tr1, 25, 0.1);
  closeTo(r.values.m1, 25, 0.1);

  const t100 = 373.15;
  const r100 = NOMINAL_SENSING.ntcNominalResistanceOhm *
    Math.exp(3984 * (1 / t100 - 1 / 298.15));
  const v100 = 3.3 * 1500 / (1500 + r100);
  closeTo(ntcVoltsToCelsius(v100, 3984), 100, 1e-9);
});

test('invalid NTC readings, rails, missing data and non-object inputs', () => {
  assert.equal(ntcVoltsToCelsius(0, 3988), null);
  assert.equal(ntcVoltsToCelsius(3.3, 3988), null);
  assert.equal(ntcVoltsToCelsius(-1, 3988), null);
  const r = convertAdcMeasurements({ tr1: 0, tr2: 4095, vpv: 4095, ipv: -1 });
  assert.equal(r.quality.tr1, 'ADC_RAIL');
  assert.equal(r.quality.tr2, 'ADC_RAIL');
  assert.equal(r.quality.vpv, 'ADC_RAIL');
  assert.equal(r.quality.ipv, 'INVALID_RAW');
  assert.equal(convertAdcMeasurements(null).quality.vpv, 'NOT_PROVIDED');
});

test('independent NTC worksheet anchors at 25, 100 and 125 C', () => {
  // Source: V_sense worksheet, R90 = 1.5k ohm, beta = 3988 K.
  closeTo(ntcVoltsToCelsius(0.430, 3988), 25, 0.1);
  closeTo(ntcVoltsToCelsius(2.271, 3988), 100, 0.1);
  closeTo(ntcVoltsToCelsius(2.679, 3988), 125, 0.1);
});
