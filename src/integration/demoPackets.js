/** Test-only deterministic varying sensor stimulus, NOT a CLLC plant model. */
import { BOARD_IDS } from '../model/telemetry.js';
import { simulateAdcInjection } from '../simulation/adcInjection.js';
import { PROTOCOL_VERSION, BENCH_POLARITY } from './protocol.js';

export function createDemoPackets(step, timestampMs = Date.now(), source = 'BROWSER_TEST') {
  return BOARD_IDS.map((boardId, i) => {
    const phase = step * 0.13 + i * 0.75;
    const tempFault = i === 1 && step % 42 >= 19 && step % 42 <= 26;
    const physical = {
      vpv: 31.7 + Math.sin(phase) * 0.8,
      ipv: 17.4 + Math.sin(phase * 0.73) * 1.4,
      vdc: 44.9 + Math.sin(phase * 0.54) * 0.7,
      idc: 11.8 + Math.sin(phase * 0.8) * 0.8,
      tr1: tempFault ? 95 : 40 + i * 1.5 + Math.sin(phase) * 2.2,
      tr2: 41 + i + Math.sin(phase + 0.7) * 1.7,
      tr3: 40 + i + Math.sin(phase + 1.1) * 1.9,
      m1: 45 + i + Math.sin(phase + 1.4) * 2.2,
      m2: 46 + i + Math.sin(phase + 1.8) * 1.8,
    };
    const converted = simulateAdcInjection(physical, { currentPolarity: BENCH_POLARITY });
    return {
      schema: PROTOCOL_VERSION,
      boardId,
      source,
      timestampMs,
      sampleCount: step * 1000 + i,
      adcDataValid: true,
      adcTimeoutCount: 0,
      adcOverflowCount: 0,
      rawBySensor: converted.rawBySensor,
      pwmEnabled: false,
      switchingFrequencyHz: null,
    };
  });
}
