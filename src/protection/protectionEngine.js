/**
 * PCB-UNVERIFIED software test for ADC-derived OVP/OCP/OTP logic.
 * Rules and limits are USER-ADJUSTABLE DEMONSTRATION ASSUMPTIONS only.
 * Neither this file nor the website controls F28388D ePWM hardware.
 */
export const DEMO_LIMITS = Object.freeze({
  vpv: 36, ipv: 40, vdc: 50, idc: 30,
  transformer: 80, mosfet: 90,
});

export const CHECKS = Object.freeze([
  { key: 'vpv', label: 'PV 입력전압', kind: 'OVP', limitKey: 'vpv', unit: 'V' },
  { key: 'ipv', label: 'PV 입력전류', kind: 'OCP', limitKey: 'ipv', unit: 'A', absolute: true },
  { key: 'vdc', label: 'DC 출력전압', kind: 'OVP', limitKey: 'vdc', unit: 'V' },
  { key: 'idc', label: 'DC 출력전류', kind: 'OCP', limitKey: 'idc', unit: 'A', absolute: true },
  { key: 'tr1', label: '변압기 1', kind: 'OTP', limitKey: 'transformer', unit: '°C' },
  { key: 'tr2', label: '변압기 2', kind: 'OTP', limitKey: 'transformer', unit: '°C' },
  { key: 'tr3', label: '변압기 3', kind: 'OTP', limitKey: 'transformer', unit: '°C' },
  { key: 'm1', label: 'MOSFET 1', kind: 'OTP', limitKey: 'mosfet', unit: '°C' },
  { key: 'm2', label: 'MOSFET 2', kind: 'OTP', limitKey: 'mosfet', unit: '°C' },
]);

export const WARNING_RATIO = 0.92;
export const RESET_RATIO = 0.92;
export const EVENT_LIMIT = 100;

export function validateDemoLimits(limits) {
  return !!limits && Object.keys(DEMO_LIMITS).every((key) =>
    typeof limits[key] === 'number' && Number.isFinite(limits[key]) && limits[key] > 0
  );
}

/**
 * Check *converted ADC measurements*, NOT text field input values.
 * Only NOMINAL_UNCALIBRATED is usable. All other quality flags are
 * reported as unverified and can never be interpreted as normal/safe.
 */
export function evaluateProtectionReport(report, limits = DEMO_LIMITS) {
  if (!validateDemoLimits(limits)) {
    return { validConfig: false, faults: [], warnings: [], unverified: ['시험 임계값 설정 오류'], clearForReset: false };
  }
  const faults = [];
  const warnings = [];
  const unverified = [];
  let belowResetThreshold = true;

  for (const check of CHECKS) {
    const quality = report?.quality?.[check.key];
    const value = report?.values?.[check.key];
    if (quality !== 'NOMINAL_UNCALIBRATED' ||
        typeof value !== 'number' || !Number.isFinite(value)) {
      unverified.push(`${check.label}: ${quality ?? '데이터 없음'}`);
      belowResetThreshold = false;
      continue;
    }

    const observed = check.absolute ? Math.abs(value) : value;
    const limit = limits[check.limitKey];
    const item = { key: check.key, label: check.label, kind: check.kind, value, limit, unit: check.unit };
    if (observed >= limit) {
      faults.push(item);
      belowResetThreshold = false;
    } else if (observed >= limit * WARNING_RATIO) {
      warnings.push(item);
      belowResetThreshold = false;
    } else if (observed >= limit * RESET_RATIO) {
      belowResetThreshold = false;
    }
  }

  return {
    validConfig: true,
    faults, warnings, unverified,
    clearForReset: faults.length === 0 && unverified.length === 0 && belowResetThreshold,
  };
}

export function createProtectionState() {
  return { phase: 'STOPPED', latched: false, cause: null, faultAt: null, events: [] };
}

function addEvent(events, type, message, now) {
  return [...events, { at: now, type, message }].slice(-EVENT_LIMIT);
}

/** Explicit fault latch and manual reset, all simulation-side only. */
export function advanceProtectionState(previous, assessment, options = {}) {
  const state = previous ?? createProtectionState();
  const { enabled = true, resetRequested = false, timestampMs = Date.now() } = options;
  const now = timestampMs;
  if (!enabled) return { ...state, phase: state.latched ? 'FAULT_LATCHED' : 'STOPPED' };

  if (!assessment || !assessment.validConfig) {
    return { ...state, phase: state.latched ? 'FAULT_LATCHED' : 'DATA_UNVERIFIED' };
  }

  if (assessment.faults.length > 0 && !state.latched) {
    const first = assessment.faults[0];
    return {
      ...state, phase: 'FAULT_LATCHED', latched: true,
      cause: `${first.kind} · ${first.label} ${first.value.toFixed(2)} ${first.unit} (시험 기준 ${first.limit} ${first.unit})`,
      faultAt: now,
      events: addEvent(state.events, 'FAULT', `${first.kind} 감지 / 가상 차단 요구`, now),
    };
  }

  if (state.latched) {
    if (resetRequested && assessment.clearForReset) {
      return {
        phase: 'NORMAL', latched: false, cause: null, faultAt: null,
        events: addEvent(state.events, 'RESET', '사용자 복귀 요청 수락 · 시험 래치 해제', now),
      };
    }
    if (resetRequested && !assessment.clearForReset) {
      return {
        ...state, phase: 'FAULT_LATCHED',
        events: addEvent(state.events, 'RESET_BLOCKED', '복귀 거부: 센서 9채널 유효·시험 복귀 한계 미충족', now),
      };
    }
    return { ...state, phase: assessment.clearForReset ? 'RESET_READY' : 'FAULT_LATCHED' };
  }

  let phase = 'NORMAL';
  if (assessment.unverified.length > 0) phase = 'DATA_UNVERIFIED';
  else if (assessment.warnings.length > 0) phase = 'WARNING';

  if (phase !== state.phase && phase === 'WARNING') {
    return { ...state, phase, events: addEvent(state.events, 'WARNING', '시험 경고 기준 도달', now) };
  }
  return { ...state, phase };
}
