/**
 * Ollagajo telemetry protocol v1. Data transport independent: browser demo,
 * local PC bridge and (future) MCU UART all share this packet schema.
 * A valid packet does NOT prove it came from real hardware.
 */
import { BOARD_IDS } from '../model/telemetry.js';
import { SENSOR_SPEC, convertAdcMeasurements } from '../model/sensorConversion.js';

export const PROTOCOL_VERSION = 'pvcllc.telemetry.v1';
export const TELEMETRY_SENSOR_KEYS = Object.freeze(Object.keys(SENSOR_SPEC));
export const BENCH_POLARITY = Object.freeze({ ipv: 1, idc: 1 });

export function validateTelemetryPacket(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return '패킷 형식 오류';
  if (packet.schema !== PROTOCOL_VERSION) return '프로토콜 버전 불일치';
  if (!BOARD_IDS.includes(packet.boardId)) return '등록되지 않은 보드';
  if (!['PC_TEST', 'BROWSER_TEST', 'MCU_UART'].includes(packet.source)) return '출처 정보 오류';
  if (!Number.isSafeInteger(packet.sampleCount) || packet.sampleCount < 0) return '샘플 카운터 오류';
  if (!Number.isFinite(packet.timestampMs) || packet.timestampMs <= 0) return '타임스탬프 오류';
  if (typeof packet.adcDataValid !== 'boolean') return 'ADC 상태값 오류';
  if (!Number.isSafeInteger(packet.adcTimeoutCount) || packet.adcTimeoutCount < 0) return '타임아웃 카운터 오류';
  if (!Number.isSafeInteger(packet.adcOverflowCount) || packet.adcOverflowCount < 0) return '오버플로 카운터 오류';
  if (!packet.rawBySensor || typeof packet.rawBySensor !== 'object') return 'ADC 9채널 누락';
  for (const key of TELEMETRY_SENSOR_KEYS) {
    const count = packet.rawBySensor[key];
    if (!Number.isInteger(count) || count < 0 || count > 4095) return `${key} ADC 원시값 오류`;
  }
  return null;
}

/** Produces the existing report shape consumed by history/protection/cooling. */
export function packetToReport(packet, options = {}) {
  const error = validateTelemetryPacket(packet);
  if (error) throw new Error(error);
  // Never assume signed current polarity for genuine serial hardware.
  const currentPolarity = options.currentPolarity ?? (packet.source === 'MCU_UART' ? {} : BENCH_POLARITY);
  const converted = convertAdcMeasurements(packet.rawBySensor, { currentPolarity });
  if (!packet.adcDataValid) {
    for (const key of TELEMETRY_SENSOR_KEYS) {
      converted.values[key] = null;
      converted.quality[key] = 'ADC_INVALID';
    }
  }
  return { ...converted, rawBySensor: packet.rawBySensor,
    packet: { boardId: packet.boardId, source: packet.source,
      sampleCount: packet.sampleCount, timestampMs: packet.timestampMs,
      adcDataValid: packet.adcDataValid,
      adcTimeoutCount: packet.adcTimeoutCount,
      adcOverflowCount: packet.adcOverflowCount,
      pwmEnabled: packet.pwmEnabled === true,
      switchingFrequencyHz: Number.isFinite(packet.switchingFrequencyHz)
        ? packet.switchingFrequencyHz : null,
    },
  };
}
