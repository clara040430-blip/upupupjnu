import { useMemo, useState } from 'react';
import {
  ADC_FILTER_CHANNELS,
  ADC_FILTER_CONFIG,
  simulateAdcFilterLab,
} from '../model/adcFilterLab.js';
import './AdcFilterLab.css';

const COLORS = { raw: '#db8b34', filtered: '#2563eb', telemetry: '#0b9470' };
const CHANNEL_NAMES = { vi: '전압·전류', temperature: '온도' };
const PLOT = { width: 840, height: 240, left: 58, right: 16, top: 18, bottom: 35 };

function TracePlot({ samples, telemetry, from, to, title, showTelemetry }) {
  const visible = samples.filter((p) => p.ms >= from && p.ms <= to);
  const values = visible.flatMap((p) => [p.rawV, p.filteredV]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.16, 0.003);
  const vmin = low - pad;
  const vmax = high + pad;
  const w = PLOT.width - PLOT.left - PLOT.right;
  const h = PLOT.height - PLOT.top - PLOT.bottom;
  const x = (ms) => PLOT.left + ((ms - from) / (to - from)) * w;
  const y = (v) => PLOT.top + ((vmax - v) / (vmax - vmin)) * h;
  const d = (key) => visible.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' ');
  const points = showTelemetry ? telemetry.filter((p) => p.ms >= from && p.ms <= to) : [];
  return <div className="adc-filter-chart-wrap">
    <div className="adc-filter-chart-heading"><strong>{title}</strong><span>{from}–{to} ms</span></div>
    <svg className="adc-filter-plot" viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="img" aria-label={`${title}: ADC 핀 전압 원시값과 EMA 필터 비교`}>
      {Array.from({ length: 5 }, (_, i) => {
        const value = vmin + (i / 4) * (vmax - vmin);
        const cy = y(value);
        return <g key={i}><line x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={cy} y2={cy} stroke="#e4eaf3" />
          <text x={PLOT.left - 8} y={cy + 4} textAnchor="end" className="adc-filter-axis">{value.toFixed(2)}</text></g>;
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const t = from + (i / 5) * (to - from);
        return <text key={i} className="adc-filter-axis" x={x(t)} y={PLOT.height - 9} textAnchor="middle">{Math.round(t)}ms</text>;
      })}
      {from < ADC_FILTER_CONFIG.stepAtMs && ADC_FILTER_CONFIG.stepAtMs <= to && <line
        x1={x(ADC_FILTER_CONFIG.stepAtMs)} x2={x(ADC_FILTER_CONFIG.stepAtMs)} y1={PLOT.top} y2={PLOT.top + h}
        stroke="#8797ad" strokeDasharray="5 5" />}
      <path d={d('rawV')} fill="none" stroke={COLORS.raw} strokeWidth="1.8" />
      <path d={d('filteredV')} fill="none" stroke={COLORS.filtered} strokeWidth="2.8" />
      {points.map((p) => <circle key={p.ms} cx={x(p.ms)} cy={y(p.filteredV)} r="5" fill={COLORS.telemetry} stroke="#fff" strokeWidth="1.7" />)}
    </svg>
  </div>;
}

export default function AdcFilterLab({ selectedId }) {
  const [channel, setChannel] = useState('vpv');
  const [scenario, setScenario] = useState('step');
  const [noiseCounts, setNoiseCounts] = useState(35);
  const [experimentalAlpha, setExperimentalAlpha] = useState(false);
  const [alpha, setAlpha] = useState(0.20);
  const spec = ADC_FILTER_CHANNELS.find((item) => item.key === channel);
  const firmwareAlpha = spec.kind === 'temperature' ? ADC_FILTER_CONFIG.temperatureAlpha : ADC_FILTER_CONFIG.viAlpha;
  const result = useMemo(() => simulateAdcFilterLab({
    channel, scenario, noiseCounts, alphaOverride: experimentalAlpha ? alpha : null,
  }), [channel, scenario, noiseCounts, experimentalAlpha, alpha]);

  return <section className="adc-filter-lab content-section" aria-labelledby="adc-filter-lab-title">
    <div className="adc-filter-header">
      <div><p className="section-kicker">ADC v2.3 · DIGITAL SIGNAL PROCESSING</p>
        <h2 id="adc-filter-lab-title">ADC 샘플링·필터링 실험실</h2>
        <p>CCS 펌웨어의 EMA 계산식을 동일하게 적용해, 1ms 가상 ADC 신호에서 원시값과 필터링값의 차이를 비교합니다.</p>
      </div>
      <span className="adc-filter-demo-tag">가상 신호 실험 · 실측 아님</span>
    </div>
    <div className="adc-filter-specs">
      <div><span>ADC 측정 주기</span><strong>1 ms</strong><small>1,000 Hz · 시험 모델</small></div>
      <div><span>웹용 스냅샷</span><strong>100 ms</strong><small>10 Hz · 계산상 저장</small></div>
      <div><span>전압·전류 EMA</span><strong>α = 0.20</strong><small>펌웨어 v2.3 설정</small></div>
      <div><span>온도 EMA</span><strong>α = 0.05</strong><small>펌웨어 v2.3 설정</small></div>
    </div>
    <div className="adc-filter-controls">
      <label>측정 채널
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          {ADC_FILTER_CHANNELS.map((item) => <option key={item.key} value={item.key}>{item.label} · {item.pin}</option>)}
        </select>
      </label>
      <label>시험 상황
        <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
          <option value="steady">정상 일정 신호</option>
          <option value="step">입력값 급변 (150ms)</option>
          <option value="pulse">순간 잡음성 펄스 (150~185ms)</option>
        </select>
      </label>
      <label>노이즈 크기 <strong>{noiseCounts} count</strong>
        <input aria-label="ADC 노이즈 크기" type="range" min="0" max="100" step="5" value={noiseCounts} onChange={(e) => setNoiseCounts(Number(e.target.value))} />
      </label>
    </div>
    <div className="adc-filter-advanced">
      <label><input type="checkbox" checked={experimentalAlpha} onChange={(e) => { setExperimentalAlpha(e.target.checked); setAlpha(firmwareAlpha); }} /> 필터 계수 변경 실험 (CCS 설정값은 변경되지 않음)</label>
      {experimentalAlpha && <label>시험용 α <strong>{alpha.toFixed(2)}</strong>
        <input type="range" min="0.01" max="1" step="0.01" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} />
      </label>}
    </div>
    <div className="adc-filter-legend"><span><i className="adc-filter-swatch raw" /> ADC 원시 전압</span>
      <span><i className="adc-filter-swatch filtered" /> EMA 필터 적용</span>
      <span><i className="adc-filter-swatch telemetry" /> 100ms 스냅샷</span></div>
    <TracePlot samples={result.samples} telemetry={result.telemetry} from={0} to={500} title="전체 측정 구간 · 1ms 간격 501개 샘플" showTelemetry />
    <TracePlot samples={result.samples} telemetry={result.telemetry} from={135} to={195} title="급변 구간 확대 · 필터 반응 속도 비교" />
    <div className="adc-filter-readouts">
      <div><span>선택 채널</span><strong>{spec.pin}</strong><small>{CHANNEL_NAMES[spec.kind]} · {spec.label}</small></div>
      <div><span>현재 적용 α</span><strong>{result.alpha.toFixed(2)}</strong><small>{experimentalAlpha ? '웹에서만 변경된 시험값' : 'CCS v2.3 값과 동일'}</small></div>
      <div><span>마지막 원시 ADC 핀 전압</span><strong>{result.last.rawV.toFixed(3)} V</strong><small>{result.last.count} / 4095 count</small></div>
      <div><span>마지막 필터 ADC 핀 전압</span><strong>{result.last.filteredV.toFixed(3)} V</strong><small>필터 출력은 MCU 전송값이 아님</small></div>
      <div><span>원시–필터 평균 차이</span><strong>{(result.meanAbsDifferenceV * 1000).toFixed(1)} mV</strong><small>이 시험 파형에서만 계산</small></div>
      <div><span>계산된 스냅샷</span><strong>{result.telemetry.length}개</strong><small>100, 200, 300, 400, 500ms</small></div>
    </div>
    <p className="adc-filter-disclaimer">현재 선택 보드: {selectedId} · 이 실험실은 기존 4개 보드의 실시간 패킷/보호 기능과 독립적인 <b>ADC 디지털 필터 단위 시험</b>입니다. 온도·전류 채널도 아직 보정되지 않은 ADC <b>핀 전압(V)</b> 단위로 표시합니다. 실제 1ms 센싱 및 100ms 전송 여부는 F28388D 보드 연결 후 검증해야 하며, 기존 자동 데모의 1초 패킷을 1ms 실측값으로 간주하지 않습니다.</p>
  </section>;
}
