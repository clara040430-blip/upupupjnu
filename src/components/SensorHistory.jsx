import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_IDS } from '../model/telemetry';
import {
  HISTORY_KEYS,
  HISTORY_GROUPS,
  appendBoardSamples,
  findValueRange,
  splitValidSegments,
} from '../model/history';
import './SensorHistory.css';

const MAX_RECORDS_PER_BOARD = 180;
const SAMPLING_INTERVAL_MS = 1000;
const COLORS = ['#44b8ff', '#ffc76d', '#77deb7', '#ca9bff', '#ff8793'];
const LABELS = {
  vpv: 'PV 입력전압',
  ipv: 'PV 입력전류',
  vdc: 'DC 출력전압',
  idc: 'DC 출력전류',
  tr1: '변압기 1',
  tr2: '변압기 2',
  tr3: '변압기 3',
  m1: 'MOSFET 1',
  m2: 'MOSFET 2',
};

const PLOT = {
  width: 900, height: 300, left: 78, right: 20, top: 18, bottom: 42,
};

function formatTime(at) {
  return new Date(at).toLocaleTimeString('ko-KR', { hour12: false });
}

function latestValidValue(samples, key) {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const value = samples[i].values[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function HistoryPlot({ samples, group }) {
  const range = useMemo(() => findValueRange(samples, group.keys), [samples, group]);
  const startAt = samples.length ? samples[0].at : 0;
  const endAt = samples.length ? samples[samples.length - 1].at : 0;
  const domainStart = Math.min(startAt, endAt - SAMPLING_INTERVAL_MS);
  const spanMs = Math.max(1, endAt - domainStart);
  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const x = (at) => PLOT.left + ((at - domainStart) / spanMs) * plotWidth;
  const y = (value) => PLOT.top + ((range.max - value) / (range.max - range.min)) * plotHeight;

  const series = group.keys.map((key, i) => ({
    key,
    color: COLORS[i],
    segments: splitValidSegments(samples, key),
    latest: latestValidValue(samples, key),
  }));

  return (
    <div className="history-chart-region">
      <div className="history-legend" aria-label="그래프 범례">
        {series.map(({ key, color, latest }) => (
          <span className="history-legend-item" key={key}>
            <span className="history-dot" style={{ background: color }} />
            {LABELS[key]}: {latest === null ? '유효 측정 없음' : `${latest.toFixed(2)} ${group.unit}`}
          </span>
        ))}
      </div>
      {range === null ? (
        <p className="history-empty">
          이 항목에는 아직 유효한 ADC 환산 기록이 없어. 센싱 시험을 시작하고 입력값을 확인해 줘.
          전류는 시험용 방향을 선택해야 그래프에 나타나.
        </p>
      ) : (
        <svg
          className="history-chart"
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          role="img"
          aria-label={`${group.title} 센싱 기록 그래프. 실제 PCB 측정이나 CLLC 물리 모델 결과가 아님`}
        >
          {Array.from({ length: 5 }, (_, i) => {
            const tickValue = range.max - (i / 4) * (range.max - range.min);
            const tickY = PLOT.top + (i / 4) * plotHeight;
            return (
              <g key={`y${i}`}>
                <line className="history-grid-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={tickY} y2={tickY}/>
                <text className="history-axis-label" x={PLOT.left - 10} y={tickY + 4} textAnchor="end">
                  {tickValue.toFixed(1)}
                </text>
              </g>
            );
          })}
          <text className="history-axis-label" x={PLOT.left} y={PLOT.height - 10} textAnchor="start">
            {formatTime(domainStart)}
          </text>
          <text className="history-axis-label" x={PLOT.width - PLOT.right} y={PLOT.height - 10} textAnchor="end">
            {formatTime(endAt)}
          </text>
          {series.map(({ key, color, segments }) => segments.map((segment, index) => {
            if (segment.length === 1) {
              return <circle key={`${key}-${index}`} cx={x(segment[0].at)} cy={y(segment[0].value)} r="4" fill={color} />;
            }
            return (
              <polyline
                key={`${key}-${index}`}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={segment.map(({ at, value }) => `${x(at).toFixed(2)},${y(value).toFixed(2)}`).join(' ')}
              />
            );
          }))}
        </svg>
      )}
    </div>
  );
}

function exportRecordsCsv(boardId, samples) {
  if (!samples.length) return;
  const header = ['timestamp_iso', 'board_id', ...HISTORY_KEYS];
  const rows = samples.map(({ at, values }) => [
    new Date(at).toISOString(),
    boardId,
    ...HISTORY_KEYS.map((key) => Number.isFinite(values[key]) ? values[key] : ''),
  ]);
  const csv = '\uFEFF' + [header, ...rows].map((row) => row.join(',')).join('\r\n');
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `pvcllc_${boardId}_adc_history.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Reads the EXISTING App.jsx reports, records a point each second while
 * signal injection is enabled, keeps board histories independent, and plots
 * the readings WITHOUT creating any virtual CLLC response.
 */
export default function SensorHistory({ reports, simulationEnabled, selectedId }) {
  const [histories, setHistories] = useState(() =>
    Object.fromEntries(BOARD_IDS.map((id) => [id, []]))
  );
  const [groupId, setGroupId] = useState('voltage');
  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  useEffect(() => {
    if (!simulationEnabled) return undefined;
    const sample = () => {
      setHistories((old) => appendBoardSamples(
        old, reportsRef.current, BOARD_IDS, Date.now(), MAX_RECORDS_PER_BOARD
      ));
    };
    sample();
    const intervalId = setInterval(sample, SAMPLING_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [simulationEnabled]);

  const samples = histories[selectedId] ?? [];
  const group = HISTORY_GROUPS.find((candidate) => candidate.id === groupId) ?? HISTORY_GROUPS[0];

  return (
    <section className="history-panel" aria-label="ADC 센싱 시간 기록">
      <div className="history-title-row">
        <div>
          <h2>{selectedId} · ADC 센싱 실시간 기록</h2>
          <p className="history-description">
            1초마다 4대 보드의 현재 가상 ADC 환산값을 기록해. 값이 일정하면 그래프는 수평선으로 보여.
          </p>
        </div>
        <span className={`history-status ${simulationEnabled ? 'recording' : ''}`}>
          {simulationEnabled ? '● 가상 신호 기록 중' : '센싱 시험 중지 · 마지막 기록 유지'}
        </span>
      </div>

      <div className="history-controls">
        <label className="history-group-selector">
          그래프 종류
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            {HISTORY_GROUPS.map((option) => (
              <option key={option.id} value={option.id}>{option.title} ({option.unit})</option>
            ))}
          </select>
        </label>
        <span className="history-count">현재 보드: {samples.length}개 기록 (최대 {MAX_RECORDS_PER_BOARD}개)</span>
        <button className="history-action" type="button" disabled={samples.length === 0}
          onClick={() => exportRecordsCsv(selectedId, samples)}>
          이 보드 CSV 저장
        </button>
        <button className="history-action history-clear" type="button" disabled={samples.length === 0}
          onClick={() => setHistories((old) => ({ ...old, [selectedId]: [] }))}>
          이 보드 기록 지우기
        </button>
      </div>

      <HistoryPlot samples={samples} group={group} />
      <p className="history-disclaimer">
        신호 주입 시험 기록 · 명목(미보정) ADC 환산값 · 실제 보드 데이터 아님 ·
        CLLC 출력 과도응답/주파수 제어를 계산한 그래프 아님 ·
        유효하지 않은 값은 0으로 대체하지 않고 그래프를 끊어 표시함 ·
        새로고침하면 기록이 초기화됨
      </p>
    </section>
  );
}
