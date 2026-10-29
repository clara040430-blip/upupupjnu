/**
 * One simulation-side protection controller shared across all views.
 * The dashboard and protection panel MUST read the same latched state.
 * Not a hardware interrupt / ePWM trip-zone implementation.
 */
import { useEffect, useMemo, useState } from 'react';
import { BOARD_IDS } from '../model/telemetry.js';
import {
  DEMO_LIMITS, evaluateProtectionReport, createProtectionState,
  advanceProtectionState, validateDemoLimits,
} from './protectionEngine.js';

const initialDraftLimits = () => Object.fromEntries(
  Object.entries(DEMO_LIMITS).map(([key, value]) => [key, String(value)])
);
const initialStates = () => Object.fromEntries(
  BOARD_IDS.map(id => [id, createProtectionState()])
);

export function useProtectionMonitor(reports, enabled) {
  const [draftLimits, setDraftLimits] = useState(initialDraftLimits);
  const limits = useMemo(() => Object.fromEntries(
    Object.keys(DEMO_LIMITS).map(key => {
      const input = draftLimits[key];
      return [key, input.trim() === '' ? NaN : Number(input)];
    })
  ), [draftLimits]);
  const validLimits = validateDemoLimits(limits);
  const assessments = useMemo(() => Object.fromEntries(
    BOARD_IDS.map(id => [id, evaluateProtectionReport(reports?.[id], limits)])
  ), [reports, limits]);
  const [states, setStates] = useState(initialStates);

  useEffect(() => {
    const timestampMs = Date.now();
    setStates(previous => Object.fromEntries(BOARD_IDS.map(id => [
      id, advanceProtectionState(previous[id], assessments[id], { enabled, timestampMs }),
    ])));
  }, [assessments, enabled]);

  function requestReset(boardId) {
    if (!enabled || !BOARD_IDS.includes(boardId)) return;
    setStates(old => ({ ...old,
      [boardId]: advanceProtectionState(old[boardId], assessments[boardId], {
        enabled: true, resetRequested: true, timestampMs: Date.now(),
      }),
    }));
  }

  function resetAll() {
    if (!enabled) setStates(initialStates());
  }

  return { draftLimits, setDraftLimits, limits, validLimits,
    assessments, states, requestReset, resetAll };
}
