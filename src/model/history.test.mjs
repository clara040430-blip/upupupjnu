import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_KEYS, HISTORY_GROUPS, getUsableValue, appendBoardSamples,
  splitValidSegments, findValueRange,
} from './history.js';

function reading(values, quality = {}) {
  return {
    values,
    quality: Object.fromEntries(
      Object.keys(values).map((k) => [k, quality[k] ?? 'NOMINAL_UNCALIBRATED'])
    ),
  };
}

test('all nine known channels and three unit-matched graph groups', () => {
  assert.equal(HISTORY_KEYS.length, 9);
  assert.deepEqual(HISTORY_GROUPS.flatMap((g) => g.keys), ['vpv', 'vdc', 'ipv', 'idc', 'tr1', 'tr2', 'tr3', 'm1', 'm2']);
});

test('only known-good nominal readings are recorded as numeric data', () => {
  assert.equal(getUsableValue(reading({ vpv: 35 }), 'vpv'), 35);
  assert.equal(getUsableValue(reading({ ipv: 20 }, { ipv: 'CURRENT_POLARITY_UNCONFIRMED' }), 'ipv'), null);
  assert.equal(getUsableValue(reading({ vdc: 0 }, { vdc: 'ADC_INPUT_CLIPPED' }), 'vdc'), null);
  assert.equal(getUsableValue(reading({ tr1: NaN }), 'tr1'), null);
  assert.equal(getUsableValue(null, 'vpv'), null);
});

test('samples are independent for each board', () => {
  const prev = { B1: [], B2: [] };
  const next = appendBoardSamples(prev, { B1: reading({ vpv: 32 }), B2: reading({ vpv: 35 }) }, ['B1', 'B2'], 1000);
  assert.equal(next.B1[0].values.vpv, 32);
  assert.equal(next.B2[0].values.vpv, 35);
  assert.equal(prev.B1.length, 0);
});

test('missing board data creates no fabricated sample', () => {
  const result = appendBoardSamples({ B1: [] }, {}, ['B1'], 1000);
  assert.equal(result.B1.length, 0);
});

test('unconfirmed current direction produces gap, not zero', () => {
  const result = appendBoardSamples({}, { B1: reading({ ipv: null, vpv: 35 }, { ipv: 'CURRENT_POLARITY_UNCONFIRMED' }) }, ['B1'], 1000);
  assert.equal(result.B1[0].values.ipv, null);
  assert.equal(result.B1[0].values.vpv, 35);
});

test('history per board is capped at configured limit', () => {
  let state = {};
  for (let i = 0; i < 5; i++) {
    state = appendBoardSamples(state, { B1: reading({ vpv: i }) }, ['B1'], i * 1000, 3);
  }
  assert.deepEqual(state.B1.map((s) => s.values.vpv), [2, 3, 4]);
});

test('segments break at null and resume without joining', () => {
  const samples = [
    { at: 1000, values: { ipv: 1 } },
    { at: 2000, values: { ipv: null } },
    { at: 3000, values: { ipv: 3 } },
    { at: 4000, values: { ipv: 4 } },
  ];
  assert.deepEqual(splitValidSegments(samples, 'ipv').map((s) => s.length), [1, 2]);
});

test('segments break during stopped sampling periods', () => {
  const samples = [
    { at: 1000, values: { vpv: 32 } },
    { at: 2000, values: { vpv: 32 } },
    { at: 9000, values: { vpv: 35 } },
  ];
  assert.deepEqual(splitValidSegments(samples, 'vpv').map((s) => s.length), [2, 1]);
});

test('range is null for all missing channels', () => {
  assert.equal(findValueRange([{ at: 1, values: { ipv: null } }], ['ipv']), null);
});

test('range includes all observed finite values and accommodates flat traces', () => {
  const normal = findValueRange([{ values: { vpv: 35, vdc: 45 } }], ['vpv', 'vdc']);
  assert.ok(normal.min < 35 && normal.max > 45);
  const flat = findValueRange([{ values: { tr1: 40 } }], ['tr1']);
  assert.ok(flat.min < 40 && flat.max > 40);
});

test('invalid parameters are rejected instead of silently corrupting history', () => {
  assert.throws(() => appendBoardSamples({}, {}, [], NaN), TypeError);
  assert.throws(() => appendBoardSamples({}, {}, [], 0, 0), RangeError);
});
