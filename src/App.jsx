import { useMemo, useState } from 'react';
import { BOARD_IDS, SENSOR_GROUPS, createEmptyBoard } from './model/telemetry';
import { SENSOR_SPEC } from './model/sensorConversion';
import {
  SENSOR_INPUT_DEFAULTS,
  simulateAdcInjection,
} from './simulation/adcInjection';
import './App.css';
import './ManualADC.css';

const initialDrafts = () => Object.fromEntries(
  BOARD_IDS.map((id) => [id, Object.fromEntries(
    Object.entries(SENSOR_INPUT_DEFAULTS).map(([key, value]) => [key, String(value)])
  )])
);

const initialPolarities = () => Object.fromEntries(
  BOARD_IDS.map((id) => [id, { ipv: '', idc: '' }])
);

const QUALITY_TEXT = {
  NOT_PROVIDED: '입력 없음',
  INVALID_INPUT: '잘못된 입력',
  INVALID_TEMPERATURE: '온도 입력 오류',
  CURRENT_POLARITY_UNCONFIRMED: '전류 방향 미선택',
  ADC_INPUT_CLIPPED: 'ADC 입력 범위 초과',
  ADC_RAIL: 'ADC 레일: 판정 불가',
  NOMINAL_UNCALIBRATED: '명목 환산(미보정)',
  CONVERSION_INVALID: '환산 불가',
};

function parseDraft(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function App() {
  const [selectedId, setSelectedId] = useState(BOARD_IDS[0]);
  const [simulationEnabled, setSimulationEnabled] = useState(false);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [polarities, setPolarities] = useState(initialPolarities);

  const reports = useMemo(() => {
    if (!simulationEnabled) return {};
    return Object.fromEntries(BOARD_IDS.map((id) => {
      const inputs = Object.fromEntries(
        Object.entries(drafts[id]).map(([key, value]) => [key, parseDraft(value)])
      );
      const currentPolarity = Object.fromEntries(
        Object.entries(polarities[id]).map(([key, sign]) =>
          [key, sign === '' ? null : Number(sign)])
      );
      return [id, simulateAdcInjection(inputs, { currentPolarity })];
    }));
  }, [simulationEnabled, drafts, polarities]);

  const report = reports[selectedId] ?? null;
  const selectedBoard = createEmptyBoard(selectedId);
  const measurements = report?.values ?? selectedBoard.measurements;

  function updateDraft(key, value) {
    setDrafts((old) => ({
      ...old,
      [selectedId]: { ...old[selectedId], [key]: value },
    }));
  }
  function updatePolarity(key, value) {
    setPolarities((old) => ({
      ...old,
      [selectedId]: { ...old[selectedId], [key]: value },
    }));
  }

  function boardLabel(id) {
    if (!simulationEnabled) return '실제 보드 미연결';
    const quality = Object.values(reports[id]?.quality ?? {});
    if (quality.includes('ADC_INPUT_CLIPPED') ||
        quality.includes('ADC_RAIL')) return '센싱 범위 주의';
    return '가상 신호 입력 중';
  }

  const inputPower = report && Number.isFinite(measurements.vpv) &&
    Number.isFinite(measurements.ipv)
    ? measurements.vpv * measurements.ipv : null;
  const outputPower = report && Number.isFinite(measurements.vdc) &&
    Number.isFinite(measurements.idc)
    ? measurements.vdc * measurements.idc : null;

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">PV-CLLC CONTROL SYSTEM</p>
          <h1>통합 모니터링 시스템</h1>
          <p className="subtitle">F28388D · PPO-MPPT · PFM-CLLC</p>
        </div>
        <div className="header-actions">
          <button
            className="simulation-button"
            type="button"
            aria-pressed={simulationEnabled}
            onClick={() => setSimulationEnabled((previous) => !previous)}
          >
            {simulationEnabled ? '센싱 시험 중지' : '센싱 시험 시작'}
          </button>
          <span className="system-state">
            {simulationEnabled ? 'SIGNAL INJECTION · 실측 아님' : '실제 보드 미연결'}
          </span>
        </div>
      </header>

      <section>
        <h2>제어보드 통합 현황</h2>
        <div className="board-grid">
          {BOARD_IDS.map((id) => (
            <button
              className={`board-card ${selectedId === id ? 'selected' : ''}`}
              type="button" key={id} onClick={() => setSelectedId(id)}
              aria-pressed={selectedId === id}
            >
              <strong>{id}</strong>
              <span>{boardLabel(id)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="manual-test-panel">
        <div className="manual-test-title">
          <div>
            <h2>{selectedId} · 가상 센서 신호 입력</h2>
            <p>각 보드는 입력값을 독립적으로 보관해. 입력 변경 즉시 ADC 모델이 다시 계산돼.</p>
          </div>
          <span className="manual-test-note">제어보드 센싱 경로 시험 · 전력변환 물리모델 아님</span>
        </div>
        <div className="manual-fields">
          {SENSOR_GROUPS.flatMap((group) => group.channels.map((channel) => (
            <label key={channel.key} className="manual-field">
              <span>{channel.label} <small>({channel.unit})</small></span>
              <input
                type="number" step="any"
                value={drafts[selectedId][channel.key]}
                onChange={(event) => updateDraft(channel.key, event.target.value)}
              />
            </label>
          )))}
        </div>
        <div className="manual-polarities">
          {['ipv', 'idc'].map((key) => (
            <label key={key}>
              <span>{key.toUpperCase()} 전류 방향 (시험 가정, 실측 검증 전)</span>
              <select
                value={polarities[selectedId][key]}
                onChange={(event) => updatePolarity(key, event.target.value)}
              >
                <option value="">미확정 · 전류 환산 보류</option>
                <option value="1">+1 (가상 회로 극성 가정)</option>
                <option value="-1">-1 (반대 극성 시험)</option>
              </select>
            </label>
          ))}
        </div>
        <p className="manual-explanation">
          여기서 입력한 9개 값은 <strong>독립적인 시험 신호</strong>야.
          CLLC 컨버터의 전력 보존, 공진 응답, PPO/PFM 제어는 아직 계산하지 않아.
          전류 환산은 시험 방향을 선택해야만 표시돼.
        </p>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <h2>{selectedId} 센싱 결과</h2>
          <span>{simulationEnabled ? '가상 ADC 신호 · 명목 설계값' : '시험 중지 · 미연결'}</span>
        </div>
        {SENSOR_GROUPS.map((group) => (
          <div key={group.title} className="sensor-section">
            <h3>{group.title}</h3>
            <div className="sensor-grid">
              {group.channels.map((channel) => (
                <div key={channel.key} className="sensor-card">
                  <span>{channel.label}</span>
                  <strong>{formatNumber(measurements[channel.key])} {Number.isFinite(measurements[channel.key]) ? channel.unit : ''}</strong>
                  <small>{report ? (QUALITY_TEXT[report.quality[channel.key]] ?? '확인 필요') : '신호 미연결'}</small>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2>가상 ADC 변환 상세</h2>
        <div className="adc-table-wrap">
          <table className="adc-detail-table">
            <thead>
              <tr>
                <th>신호</th><th>ADC 채널</th><th>입력값</th><th>가상 ADC 핀 전압</th>
                <th>ADC 원시값</th><th>복원값</th><th>품질 / 주의</th>
              </tr>
            </thead>
            <tbody>
              {SENSOR_GROUPS.flatMap((group) => group.channels.map((channel) => (
                <tr key={channel.key}>
                  <td>{channel.label}</td>
                  <td>{SENSOR_SPEC[channel.key].adcInput}</td>
                  <td>{drafts[selectedId][channel.key]} {channel.unit}</td>
                  <td>{formatNumber(report?.adcPinVoltageV[channel.key], 4)} V</td>
                  <td>{report?.rawBySensor[channel.key] ?? '—'} / 4095</td>
                  <td>{formatNumber(measurements[channel.key], 3)} {channel.unit}</td>
                  <td>{report ? (QUALITY_TEXT[report.quality[channel.key]] ?? '확인 필요') : '미연결'}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>전력 계산 및 제어 상태</h2>
        <div className="sensor-grid">
          <div className="sensor-card">
            <span>입력전력 (단순 Vpv × Ipv)</span>
            <strong>{formatNumber(inputPower)} {Number.isFinite(inputPower) ? 'W' : ''}</strong>
            <small>전류 시험 방향이 지정된 경우에만 계산</small>
          </div>
          <div className="sensor-card">
            <span>출력전력 (단순 Vdc × Idc)</span>
            <strong>{formatNumber(outputPower)} {Number.isFinite(outputPower) ? 'W' : ''}</strong>
            <small>물리적인 컨버터 출력 예측값 아님</small>
          </div>
          <div className="sensor-card">
            <span>PFM 주파수 · PPO/IAA</span>
            <strong>미연동</strong>
            <small>제어 알고리즘·PSIM 모델 검증 후 연결</small>
          </div>
          <div className="sensor-card">
            <span>실제 PWM · 보호 상태</span>
            <strong>확인 불가</strong>
            <small>실제 F28388D는 연결되지 않음</small>
          </div>
        </div>
      </section>

      <footer className="dashboard-footer">
        ADC 신호 주입 시험 전용 · 명목(미보정) 환산 · 실제 PCB 보호 동작을 입증하지 않음
      </footer>
    </main>
  );
}

export default App;
