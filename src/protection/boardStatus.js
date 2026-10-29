/** Status shared by overview and protection module. Never label missing data NORMAL. */
export function resolveBoardStatus({ enabled, report, state, sourceMode, stale = false }) {
  if (state?.latched) return { label: 'FAULT 래치', kind: 'fault' };
  if (stale) return { label: '통신 데이터 지연', kind: 'unverified' };
  if (!enabled) return { label: '시험 대기', kind: 'idle' };
  if (!report) return { label: '데이터 수신 대기', kind: 'unverified' };
  const q = Object.values(report.quality ?? {});
  if (q.length !== 9 || q.some(value => value !== 'NOMINAL_UNCALIBRATED')) {
    return { label: '센서 확인 불가', kind: 'unverified' };
  }
  if (state?.phase === 'WARNING') return { label: '경고', kind: 'warning' };
  if (state?.phase !== 'NORMAL') return { label: '보호 판정 대기', kind: 'unverified' };
  return { label: sourceMode === 'manual' ? '정상 · 수동 시험' : '정상 · 가상 수신', kind: 'normal' };
}
