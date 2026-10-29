import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPackets } from './demoPackets.js';
import { packetToReport, validateTelemetryPacket, TELEMETRY_SENSOR_KEYS } from './protocol.js';
import { evaluateProtectionReport, DEMO_LIMITS } from '../protection/protectionEngine.js';

test('all four demonstration packets implement the shared 9-channel protocol', () => {
  const frames = createDemoPackets(2, 2000000000000);
  assert.equal(frames.length, 4);
  for (const packet of frames) {
    assert.equal(validateTelemetryPacket(packet), null);
    assert.equal(Object.keys(packet.rawBySensor).length, 9);
    assert.deepEqual(Object.keys(packet.rawBySensor).sort(), [...TELEMETRY_SENSOR_KEYS].sort());
    const report = packetToReport(packet);
    assert.ok(report.values.vpv > 25);
    assert.ok(report.values.vdc > 40);
    assert.ok(Number.isFinite(report.values.tr1));
    assert.ok(Number.isFinite(report.values.ipv));
    assert.equal(report.packet.pwmEnabled, false);
  }
});

test('a hardware-invalid ADC frame cannot masquerade as usable sensor readings', () => {
  const frame = { ...createDemoPackets(1)[0], adcDataValid: false };
  const report = packetToReport(frame);
  assert.ok(Object.values(report.values).every((x) => x === null));
  assert.ok(Object.values(report.quality).every((x) => x === 'ADC_INVALID'));
});

test('reject out-of-range ADC values and unknown board IDs', () => {
  const frame = createDemoPackets(0)[0];
  assert.match(validateTelemetryPacket({ ...frame, boardId: 'BOARD-05' }), /보드/);
  assert.match(validateTelemetryPacket({ ...frame, rawBySensor: { ...frame.rawBySensor, tr1: 9000 } }), /tr1/);
});

test('board 02 synthetic thermal excursion is visible in ADC-derived conversion', () => {
  const packet = createDemoPackets(20)[1];
  assert.ok(packetToReport(packet).values.tr1 > 80);
});


test('bridge-compatible packet feeds existing protection algorithm with a demo-only thermal fault', () => {
  const packets = createDemoPackets(20);
  const boardOne = evaluateProtectionReport(packetToReport(packets[0]), DEMO_LIMITS);
  const boardTwo = evaluateProtectionReport(packetToReport(packets[1]), DEMO_LIMITS);
  assert.equal(boardOne.faults.length, 0);
  assert.ok(boardTwo.faults.some((f) => f.key === 'tr1' && f.kind === 'OTP'));
});


test('MCU serial data never receives a guessed current polarity', () => {
  const packet = { ...createDemoPackets(1)[0], source: 'MCU_UART' };
  const report = packetToReport(packet);
  assert.equal(report.values.ipv, null);
  assert.equal(report.values.idc, null);
  assert.equal(report.quality.ipv, 'CURRENT_DIRECTION_UNCONFIRMED');
});
