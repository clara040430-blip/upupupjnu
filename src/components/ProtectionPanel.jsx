import { BOARD_IDS } from '../model/telemetry';
import {
  WARNING_RATIO, RESET_RATIO,
} from '../protection/protectionEngine';
import './ProtectionPanel.css';

const FIELDS = [
  {key:'vpv', label:'PV 과전압', unit:'V'},
  {key:'ipv', label:'PV 과전류 절댓값', unit:'A'},
  {key:'vdc', label:'DC 과전압', unit:'V'},
  {key:'idc', label:'DC 과전류 절댓값', unit:'A'},
  {key:'transformer', label:'변압기 과열', unit:'°C'},
  {key:'mosfet', label:'MOSFET 과열', unit:'°C'},
];
const STATES = {
  STOPPED: '시험 중지', NORMAL: '정상',
  WARNING: '경고', DATA_UNVERIFIED: '센서 확인 불가',
  FAULT_LATCHED: 'FAULT 래치', RESET_READY: '복귀 요청 대기',
};
export default function ProtectionPanel({ monitor, simulationEnabled, selectedId }) {
  const { draftLimits, setDraftLimits, validLimits, assessments, states,
    requestReset, resetAll } = monitor;
  const selected = states[selectedId];
  const assessment = assessments[selectedId];
  const canReset = simulationEnabled && validLimits && selected.latched && assessment.clearForReset;
  const displayPhase = !simulationEnabled && selected.latched
    ? 'FAULT_LATCHED' : (simulationEnabled ? selected.phase : 'STOPPED');

  function resetAllDemo() {
    if (simulationEnabled) return;
    if (!window.confirm('시험 중지 상태에서만 초기화합니다. 모든 보드의 시험 상태와 이벤트 기록을 삭제할까요?')) return;
    resetAll();
  }

  return (
    <section className="protect-panel" aria-label="가상 소프트웨어 보호 판단">
      <div className="protect-title-row">
        <div>
          <h2>과전압·과전류·과열 보호 시뮬레이션</h2>
          <p>ADC 환산값으로 과전압·과전류·과열을 판정하고 FAULT 발생 및 복귀 과정을 기록합니다.</p>
        </div>
        <span className="protect-sim-tag">보호 판정 규칙</span>
      </div>

      <div className="protect-summary">
        {BOARD_IDS.map((id) => (
          <div className="protect-mini" key={id}>
            <strong>{id}</strong>
            <span>{!simulationEnabled && states[id]?.latched ? 'FAULT 래치(시험 중지)' : (simulationEnabled ? (STATES[states[id]?.phase] ?? '확인 중') : '시험 중지')}</span>
          </div>
        ))}
      </div>

      <h3>보호 시험 임계값 설정</h3>
      <p className="protect-hint">경고 기준은 설정값의 {Math.round(WARNING_RATIO*100)}%, 복귀 허용 기준은 모든 신호가 설정값의 {Math.round(RESET_RATIO*100)}% 미만일 때입니다. 수치는 시험용으로 변경할 수 있습니다.</p>
      <div className="protect-fields">
        {FIELDS.map(field => (
          <label className="protect-field" key={field.key}>
            <span>{field.label} ({field.unit})</span>
            <input type="number" min="0.001" step="any"
              value={draftLimits[field.key]}
              onChange={(event) => setDraftLimits(old=>({...old,[field.key]:event.target.value}))}
            />
          </label>
        ))}
      </div>
      {!validLimits && <p className="protect-error" role="alert">모든 시험 임계값은 0보다 큰 숫자여야 합니다. 설정이 유효할 때까지 보호 판정을 보류합니다.</p>}

      <div className="protect-status-row">
        <div className={`protect-status protect-${displayPhase.toLowerCase().replaceAll('_','-')}`}>
          <span>{selectedId} · 판정 결과</span>
          <strong>{STATES[displayPhase] ?? '확인 필요'}</strong>
          <small>{selected.latched ? 'FAULT 유지 · 차단 요구 표시' : '차단 요구 없음'}</small>
        </div>
        <div className="protect-actions">
          <button type="button" onClick={() => requestReset(selectedId)} disabled={!simulationEnabled || !selected.latched}>
            시험 보호 복귀 요청
          </button>
          <button type="button" className="protect-secondary" onClick={resetAllDemo} disabled={simulationEnabled}>
            시험 중지 후 전체 상태 초기화
          </button>
          {selected.latched && !canReset && <small>복귀하려면 9채널 품질과 모든 복귀 조건을 만족해야 합니다.</small>}
        </div>
      </div>

      {selected.cause && <p className="protect-fault">최초 래치 원인: {selected.cause}</p>}
      {simulationEnabled && assessment && <div className="protect-results">
        <p><strong>기준 초과:</strong> {assessment.faults.length ? assessment.faults.map(f=>`${f.label} ${f.value.toFixed(2)}${f.unit} ≥ ${f.limit}${f.unit}`).join(' / ') : '없음'}</p>
        <p><strong>경고 범위:</strong> {assessment.warnings.length ? assessment.warnings.map(x=>x.label).join(', ') : '없음'}</p>
        <p><strong>품질 미확인:</strong> {assessment.unverified.length ? assessment.unverified.join(' / ') : '없음'}</p>
      </div>}

      <h3>현재 보드 보호 이벤트 기록</h3>
      {selected.events.length === 0 ? <p className="protect-hint">아직 기록된 이벤트가 없습니다.</p> : (
        <div className="protect-events-wrap"><table className="protect-events"><thead><tr><th>시각</th><th>유형</th><th>내용</th></tr></thead><tbody>
          {[...selected.events].reverse().map((event,index) => <tr key={`${event.at}-${index}`}>
            <td>{new Date(event.at).toLocaleTimeString('ko-KR')}</td><td>{event.type}</td><td>{event.message}</td>
          </tr>)}
        </tbody></table></div>
      )}
      
    </section>
  );
}
