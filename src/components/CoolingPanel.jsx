import { useMemo, useState } from 'react';
import { buildCoolingSeries, coolingTimeToTarget, firstOrderTemperature } from '../thermal/coolingModel';
import './CoolingPanel.css';

const TEMP_CHANNELS = [
  {key:'tr1',label:'변압기 1',group:'transformer'},
  {key:'tr2',label:'변압기 2',group:'transformer'},
  {key:'tr3',label:'변압기 3',group:'transformer'},
  {key:'m1',label:'MOSFET 1',group:'mosfet'},
  {key:'m2',label:'MOSFET 2',group:'mosfet'},
];
const SCENARIOS = [
  {delta:-10, color:'#2393cf', suffix:'주변 온도 −10°C'},
  {delta:0, color:'#1557b0', suffix:'설정 주변 온도'},
  {delta:10, color:'#ed9645', suffix:'주변 온도 +10°C'},
];
const GRAPH = {width:840,height:278,left:54,right:20,top:14,bottom:34};

function numericInput(value) {
  if (String(value).trim() === '') return null;
  const n=Number(value);
  return Number.isFinite(n) ? n : null;
}
function displayTemp(value) { return Number.isFinite(value) ? `${value.toFixed(1)}°C` : '—'; }
function displayTime(seconds) {
  if (seconds === null) return '도달하지 않음';
  if (seconds === 0) return '이미 도달';
  return seconds < 60 ? `${seconds.toFixed(0)}초` : `${(seconds/60).toFixed(1)}분`;
}

function CoolingGraph({ initial, ambient, tau, duration }) {
  const curves = useMemo(() => SCENARIOS.map(s => ({
    ...s, ambientC:ambient+s.delta,
    points:buildCoolingSeries(initial,ambient+s.delta,tau,duration,Math.max(5,duration/120)),
  })), [initial,ambient,tau,duration]);
  const allY=curves.flatMap(c=>c.points.map(p=>p.temperatureC));
  if (!allY.length) return null;
  const low=Math.min(...allY); const high=Math.max(...allY);
  const pad=Math.max(2,(high-low)*.12);
  const min=low-pad; const max=high+pad;
  const w=GRAPH.width-GRAPH.left-GRAPH.right;
  const h=GRAPH.height-GRAPH.top-GRAPH.bottom;
  const x=t=>GRAPH.left+(t/duration)*w;
  const y=v=>GRAPH.top+((max-v)/(max-min))*h;
  return (
    <div className="cool-chart-area">
      <div className="cool-legend">{curves.map(c=><span key={c.delta}><i style={{background:c.color}}/>{c.suffix} ({c.ambientC.toFixed(0)}°C)</span>)}</div>
      <svg className="cool-chart" role="img" aria-label="설정한 세 가지 주변 온도별 냉각 온도 계산 곡선" viewBox={`0 0 ${GRAPH.width} ${GRAPH.height}`}>
        {Array.from({length:5},(_,i)=>{
          const t=min+(max-min)*(4-i)/4; const py=y(t);
          return <g key={i}><line x1={GRAPH.left} x2={GRAPH.width-GRAPH.right} y1={py} y2={py} stroke="#e4ebf3"/><text x={GRAPH.left-8} y={py+4} textAnchor="end" fill="#6d8094" fontSize="12">{t.toFixed(0)}°</text></g>;
        })}
        {Array.from({length:5},(_,i)=>{const t=duration*i/4;return <text key={i} x={x(t)} y={GRAPH.height-8} textAnchor={i===0?'start':i===4?'end':'middle'} fill="#6d8094" fontSize="12">{(t/60).toFixed(0)}분</text>;})}
        {curves.map(c=><polyline key={c.delta} points={c.points.map(p=>`${x(p.elapsedSeconds).toFixed(2)},${y(p.temperatureC).toFixed(2)}`).join(' ')} stroke={c.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke"/>)}
      </svg>
    </div>
  );
}

export default function CoolingPanel({ report, simulationEnabled, selectedId }) {
  const [ambientInput,setAmbientInput]=useState('25');
  const [transformerTauInput,setTransformerTauInput]=useState('180');
  const [mosfetTauInput,setMosfetTauInput]=useState('90');
  const [targetInput,setTargetInput]=useState('45');
  const [durationInput,setDurationInput]=useState('10');
  const [selectedKey,setSelectedKey]=useState('tr1');
  const ambient=numericInput(ambientInput), transformerTau=numericInput(transformerTauInput);
  const mosfetTau=numericInput(mosfetTauInput), target=numericInput(targetInput);
  const durationMin=numericInput(durationInput);
  const valid=ambient!==null && ambient>=-55 && ambient<=125 &&
    transformerTau!==null && transformerTau>0 && transformerTau<=7200 &&
    mosfetTau!==null && mosfetTau>0 && mosfetTau<=7200 &&
    target!==null && target>=-55 && target<=200 &&
    durationMin!==null && durationMin>=1 && durationMin<=60;
  const sensors=TEMP_CHANNELS.map(s=>{
    const quality=report?.quality?.[s.key];
    const initial=simulationEnabled && quality==='NOMINAL_UNCALIBRATED' && Number.isFinite(report?.values?.[s.key])
      ? report.values[s.key] : null;
    const tau=s.group==='transformer'?transformerTau:mosfetTau;
    return {...s,initial,tau,afterOneMinute:valid && initial!==null ? firstOrderTemperature(initial,ambient,tau,60):null,
      afterFiveMinutes:valid && initial!==null ? firstOrderTemperature(initial,ambient,tau,300):null,
      targetSeconds:valid && initial!==null ? coolingTimeToTarget(initial,ambient,tau,target):null};
  });
  const focus=sensors.find(s=>s.key===selectedKey)??sensors[0];
  const canDraw=valid && focus.initial!==null;
  return <section className="cooling-panel" aria-labelledby="cooling-title">
    <div className="cooling-head"><div><p className="cooling-eyebrow">THERMAL ANALYSIS</p><h2 id="cooling-title">{selectedId} · 주변 온도별 냉각 계산</h2><p>현재 온도 센싱값을 시작점으로, 열원 차단 후의 온도 변화를 1차 열 모델로 계산합니다.</p></div><span className="cooling-label">냉각 시정수(τ) 조정 가능</span></div>
    <div className="cooling-equation">T(t) = T주변 + (T시작 − T주변) × exp(−t / τ)</div>
    <div className="cooling-controls">
      <label>주변 온도 (°C)<input type="number" step="any" value={ambientInput} onChange={e=>setAmbientInput(e.target.value)}/></label>
      <label>변압기 τ (초, 가정)<input type="number" min="1" step="any" value={transformerTauInput} onChange={e=>setTransformerTauInput(e.target.value)}/></label>
      <label>MOSFET τ (초, 가정)<input type="number" min="1" step="any" value={mosfetTauInput} onChange={e=>setMosfetTauInput(e.target.value)}/></label>
      <label>목표 온도 (°C)<input type="number" step="any" value={targetInput} onChange={e=>setTargetInput(e.target.value)}/></label>
      <label>그래프 시간 (분)<input type="number" min="1" max="60" step="1" value={durationInput} onChange={e=>setDurationInput(e.target.value)}/></label>
    </div>
    {!valid && <p className="cooling-validation" role="alert">입력값을 확인해 주세요. 주변 온도 −55~125°C, 시정수 0초 초과~7200초, 목표 온도 −55~200°C, 시간 1~60분을 입력할 수 있습니다.</p>}
    <div className="cooling-section-title"><h3>냉각 곡선 비교</h3><label>표시할 센서<select value={selectedKey} onChange={e=>setSelectedKey(e.target.value)}>{TEMP_CHANNELS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></label></div>
    {canDraw ? <CoolingGraph initial={focus.initial} ambient={ambient} tau={focus.tau} duration={durationMin*60}/> : <p className="cooling-empty">{!simulationEnabled?'상단에서 센싱 시험을 시작하시면 냉각 계산을 확인할 수 있습니다.':!valid?'입력값을 수정해 주세요.':'선택한 온도 센서의 유효한 값을 확인해 주세요.'}</p>}
    <div className="cooling-section-title"><h3>5개 온도 센서 비교</h3><span>지정한 주변 온도 기준</span></div>
    <div className="cooling-table-wrap"><table className="cooling-table"><thead><tr><th>센서</th><th>시작 온도</th><th>1분 후</th><th>5분 후</th><th>목표 온도 도달</th></tr></thead><tbody>{sensors.map(s=><tr key={s.key}><td>{s.label}</td><td>{displayTemp(s.initial)}</td><td>{displayTemp(s.afterOneMinute)}</td><td>{displayTemp(s.afterFiveMinutes)}</td><td>{!valid||s.initial===null?'—':displayTime(s.targetSeconds)}</td></tr>)}</tbody></table></div>
    <p className="cooling-footnote">시정수는 예시 입력값입니다. 시작 온도보다 주변 온도가 높으면 온도가 상승하는 곡선이 표시됩니다. 계산 결과는 보호 복귀를 자동 실행하지 않습니다.</p>
  </section>;
}
