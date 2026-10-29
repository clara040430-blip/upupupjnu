import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptNextPacket, freshFrames, hasStaleFrame } from './streamHealth.js';

const mk = (sampleCount, timestampMs = 100000) => ({ sampleCount, timestampMs });

test('first bridge packet is accepted and remains fresh for 5s from PC receipt', () => {
  const first = acceptNextPacket(undefined, mk(10), 1000);
  assert.equal(first.accepted, true);
  const frames = { 'BOARD-01': first.frame };
  assert.equal(Object.keys(freshFrames(frames, 6000)).length, 1);
  assert.equal(Object.keys(freshFrames(frames, 6001)).length, 0);
  assert.equal(hasStaleFrame(frames, 'BOARD-01', 6001), true);
});

test('duplicate and out-of-order packets rejected, newer accepted', () => {
  const old = acceptNextPacket(undefined, mk(11, 200), 100).frame;
  assert.match(acceptNextPacket(old, mk(11, 210), 150).reason, /중복/);
  assert.match(acceptNextPacket(old, mk(10, 210), 150).reason, /중복/);
  assert.match(acceptNextPacket(old, mk(12, 190), 150).reason, /역순/);
  assert.equal(acceptNextPacket(old, mk(12, 210), 150).accepted, true);
});

test('freshness is per board and only based on receive time', () => {
  const a = acceptNextPacket(undefined, mk(1, 99999999), 500).frame;
  const b = acceptNextPacket(undefined, mk(1, 2), 5500).frame;
  const frames = { 'BOARD-01': a, 'BOARD-02': b };
  assert.deepEqual(Object.keys(freshFrames(frames, 5600)), ['BOARD-02']);
  assert.equal(hasStaleFrame(frames, 'BOARD-03', 5600), false);
});
