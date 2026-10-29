import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_LIMITS, CHECKS, evaluateProtectionReport,
  createProtectionState, advanceProtectionState, validateDemoLimits,
} from './protectionEngine.js';

function report(patch = {}, qualityPatch = {}) {
  const values = Object.fromEntries(CHECKS.map(({key}) => [key,
    ({vpv:32, ipv:20, vdc:45, idc:12, tr1:40, tr2:41, tr3:42, m1:45, m2:46})[key]
  ]));
  const quality = Object.fromEntries(CHECKS.map(({key}) => [key, 'NOMINAL_UNCALIBRATED']));
  return { values: { ...values, ...patch }, quality: { ...quality, ...qualityPatch } };
}

test('defaults are positive and recognized by threshold validator', () => {
  assert.equal(validateDemoLimits(DEMO_LIMITS), true);
  assert.equal(validateDemoLimits({...DEMO_LIMITS, vpv:0}), false);
  assert.equal(validateDemoLimits({...DEMO_LIMITS, idc:NaN}), false);
});

test('normal nominal ADC readings cause no faults', () => {
  const a = evaluateProtectionReport(report());
  assert.equal(a.faults.length, 0);
  assert.equal(a.unverified.length, 0);
  assert.equal(a.warnings.length, 0);
});

test('fault limit comparison is inclusive and uses measured values', () => {
  const a = evaluateProtectionReport(report({vdc:DEMO_LIMITS.vdc}));
  assert.equal(a.faults.length, 1);
  assert.equal(a.faults[0].kind, 'OVP');
});

test('current is compared by magnitude once direction was validated', () => {
  const a = evaluateProtectionReport(report({ipv:-41, idc:-31}));
  assert.deepEqual(a.faults.map(x => x.key), ['ipv','idc']);
});

test('transformer/MOSFET temperatures use separate demonstration limits', () => {
  const a = evaluateProtectionReport(report({tr2:81, m1:91}));
  assert.deepEqual(a.faults.map(x => x.key), ['tr2','m1']);
});

test('92% threshold gives warning, not FAULT', () => {
  const a = evaluateProtectionReport(report({vpv:33.5}));
  assert.equal(a.faults.length, 0);
  assert.equal(a.warnings.length, 1);
});

test('unconfirmed current direction remains unverified, not normal', () => {
  const a = evaluateProtectionReport(report({}, {ipv:'CURRENT_POLARITY_UNCONFIRMED'}));
  assert.equal(a.unverified.length, 1);
  const s = advanceProtectionState(createProtectionState(), a);
  assert.equal(s.phase, 'DATA_UNVERIFIED');
});

test('ADC clipped readings are never evaluated as accurate measurements', () => {
  const a = evaluateProtectionReport(report({vpv:999}, {vpv:'ADC_INPUT_CLIPPED'}));
  assert.equal(a.faults.length, 0);
  assert.equal(a.unverified.length, 1);
});

test('other valid sensors can FAULT while one sensor is unverified', () => {
  const a = evaluateProtectionReport(report({tr1:90}, {ipv:'CURRENT_POLARITY_UNCONFIRMED'}));
  assert.equal(a.faults.length, 1);
  const s = advanceProtectionState(createProtectionState(), a);
  assert.equal(s.latched, true);
});

test('FAULT latches and does not clear automatically', () => {
  const tripped = advanceProtectionState(createProtectionState(), evaluateProtectionReport(report({tr1:95})), {timestampMs:100});
  assert.equal(tripped.phase, 'FAULT_LATCHED');
  assert.equal(tripped.events.length, 1);
  const recovered = advanceProtectionState(tripped, evaluateProtectionReport(report()), {timestampMs:200});
  assert.equal(recovered.phase, 'RESET_READY');
  assert.equal(recovered.latched, true);
});

test('manual reset succeeds only after all channels are valid and below recovery ratio', () => {
  const tripped = advanceProtectionState(createProtectionState(), evaluateProtectionReport(report({vdc:52})), {timestampMs:1});
  const stillHigh = advanceProtectionState(tripped, evaluateProtectionReport(report({vdc:47})), {timestampMs:2, resetRequested:true});
  assert.equal(stillHigh.latched, true);
  assert.equal(stillHigh.events.at(-1).type, 'RESET_BLOCKED');
  const stillInvalid = advanceProtectionState(stillHigh, evaluateProtectionReport(report({}, {idc:'NOT_PROVIDED'})), {timestampMs:3, resetRequested:true});
  assert.equal(stillInvalid.latched, true);
  const reset = advanceProtectionState(stillInvalid, evaluateProtectionReport(report()), {timestampMs:4, resetRequested:true});
  assert.equal(reset.phase, 'NORMAL');
  assert.equal(reset.latched, false);
  assert.equal(reset.events.at(-1).type, 'RESET');
});

test('STOPPED never means verified NORMAL and preserves latched faults', () => {
  const initial = advanceProtectionState(createProtectionState(), evaluateProtectionReport(report()), {enabled:false});
  assert.equal(initial.phase, 'STOPPED');
  const fault = advanceProtectionState(initial, evaluateProtectionReport(report({m2:99})));
  assert.equal(advanceProtectionState(fault, evaluateProtectionReport(report()), {enabled:false}).latched, true);
});

test('individual boards can maintain separate state with same engine', () => {
  const a = advanceProtectionState(createProtectionState(), evaluateProtectionReport(report({tr3:99})));
  const b = advanceProtectionState(createProtectionState(), evaluateProtectionReport(report()));
  assert.equal(a.latched, true);
  assert.equal(b.latched, false);
});

test('event history does not grow without bound', () => {
  let s = createProtectionState();
  for (let i=0;i<130;i++) {
    s=advanceProtectionState(s,evaluateProtectionReport(report({vpv:38})),{timestampMs:i*3});
    s=advanceProtectionState(s,evaluateProtectionReport(report()),{timestampMs:i*3+1,resetRequested:true});
  }
  assert.equal(s.events.length, 100);
});
