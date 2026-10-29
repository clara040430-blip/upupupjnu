
import { BOARD_IDS, createEmptyBoard } from '../model/telemetry';

// 개발 및 통신 시험용 가상 측정 데이터
// 실제 측정값이나 PSIM 검증 결과가 아님

export function createSimulatedBoards(elapsedSeconds) {
  return BOARD_IDS.map((id, index) => {
    const t = elapsedSeconds;
    const phase = t * 0.6 + index * 0.7;

    // PV 입력 측정값
    const vpv = 32 + index * 0.2 + 0.4 * Math.sin(phase);
    const ipv = 25 + index * 0.3 + 0.6 * Math.sin(phase * 0.8);

    // DC 출력 측정값
    const vdc = 45 + 0.3 * Math.sin(phase * 0.9);
    const idc = 16 + index * 0.2 + 0.4 * Math.sin(phase * 0.7);

    // 변압기 온도 3채널
    const tr1 = 38 + index + 0.4 * Math.sin(t * 0.08);
    const tr2 = 40 + index + 0.5 * Math.sin(t * 0.07);
    const tr3 = 37 + index + 0.3 * Math.sin(t * 0.09);

    // MOSFET 온도 2채널
    const m1 = 42 + index + 0.5 * Math.sin(t * 0.1);
    const m2 = 43 + index + 0.4 * Math.sin(t * 0.09);

    return {
      ...createEmptyBoard(id),
      connection: 'SIMULATED',
      source: 'SIMULATED',
      timestamp: new Date().toISOString(),

      measurements: {
        vpv,
        ipv,
        vdc,
        idc,
        tr1,
        tr2,
        tr3,
        m1,
        m2,
      },
    };
  });
}
