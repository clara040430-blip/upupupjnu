import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoardStatus } from './boardStatus.js';
import { createDemoPackets } from '../integration/demoPackets.js';
import { packetToReport } from '../integration/protocol.js';
import { createProtectionState, advanceProtectionState, evaluateProtectionReport } from './protectionEngine.js';

const good = packetToReport(createDemoPackets(1)[0]);
const normal = { phase: 'NORMAL', latched: false };

test('healthy sample displays normal, but stale stream cannot masquerade as normal', () => {
  assert.equal(resolveBoardStatus({ enabled: true, report: good, state: normal, sourceMode: 'demo' }).kind, 'normal');
  assert.equal(resolveBoardStatus({ enabled: true, report: good, state: normal, stale: true }).kind, 'unverified');
  assert.equal(resolveBoardStatus({ enabled: true, report: null, state: normal }).kind, 'unverified');
});

test('FAULT remains visible on overview even if sensing is stopped or stale', () => {
  const tripped = advanceProtectionState(createProtectionState(), evaluateProtectionReport(packetToReport(createDemoPackets(20)[1])));
  assert.equal(tripped.latched, true);
  assert.equal(resolveBoardStatus({ enabled: false, report: null, state: tripped }).label, 'FAULT 래치');
  assert.equal(resolveBoardStatus({ enabled: true, report: null, state: tripped, stale: true }).kind, 'fault');
});

test('warnings and missing channel quality are not NORMAL', () => {
  assert.equal(resolveBoardStatus({ enabled: true, report: good, state: { phase: 'WARNING' } }).kind, 'warning');
  assert.equal(resolveBoardStatus({ enabled: true, report: { quality: { vpv: 'ADC_INVALID' } }, state: normal }).kind, 'unverified');
});
