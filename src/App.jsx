
import { useEffect, useMemo, useState } from 'react';

import {
  BOARD_IDS,
  SENSOR_GROUPS,
  createEmptyBoard,
} from './model/telemetry';

import { SENSOR_SPEC } from './model/sensorConversion';

import {
  SENSOR_INPUT_DEFAULTS,
  simulateAdcInjection,
} from './simulation/adcInjection';

import SensorHistory from './components/SensorHistory';
import AdcFilterLab from './components/AdcFilterLab';

import './App.css';
import './ManualADC.css';
import ProtectionPanel from './components/ProtectionPanel';
import CoolingPanel from './components/CoolingPanel';
import { createDemoPackets } from './integration/demoPackets';
import { packetToReport, validateTelemetryPacket } from './integration/protocol';
// ============================================================
// Initial sensor inputs for four independent boards
// ============================================================

const initialDrafts = () =>
  Object.fromEntries(
    BOARD_IDS.map((id) => [
      id,
      Object.fromEntries(
        Object.entries(SENSOR_INPUT_DEFAULTS).map(
          ([key, value]) => [key, String(value)]
        )
      ),
    ])
  );

const initialPolarities = () =>
  Object.fromEntries(
    BOARD_IDS.map((id) => [
      id,
      { ipv: '', idc: '' },
    ])
  );

// ============================================================
// ADC conversion quality descriptions
// ============================================================

const QUALITY_TEXT = {
  NOT_PROVIDED: '입력 없음',
  INVALID_INPUT: '잘못된 입력',
  INVALID_TEMPERATURE: '온도 입력 오류',
  CURRENT_POLARITY_UNCONFIRMED: '전류 방향 미선택',
  ADC_INPUT_CLIPPED: 'ADC 입력 범위 초과',
  ADC_RAIL: 'ADC 레일: 판정 불가',
  NOMINAL_UNCALIBRATED: '명목 환산(미보정)',
  CONVERSION_INVALID: '환산 불가',
  CURRENT_DIRECTION_UNCONFIRMED: '전류 방향 미확정',
  INVALID_RAW: '원시 ADC 입력 오류',
  ADC_INVALID: 'ADC 측정 실패',
};

// ============================================================
// Helper functions
// ============================================================

function parseDraft(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value)
    ? value.toFixed(digits)
    : '—';
}

// ============================================================
// Main application
// ============================================================

function App() {
  // ----------------------------------------------------------
  // Board and simulation state
  // ----------------------------------------------------------

  const [selectedId, setSelectedId] = useState(
    BOARD_IDS[0]
  );

  // Team-shareable integration demo uses the same 9-channel telemetry
  // contract as the future F28388D serial bridge. No real MCU is implied.
  const [sourceMode, setSourceMode] = useState('demo');
  const [demoRunning, setDemoRunning] = useState(true);
  const [demoPackets, setDemoPackets] = useState({});
  const [bridgePackets, setBridgePackets] = useState({});
  const [bridgeUrl, setBridgeUrl] = useState('http://127.0.0.1:8765/events');
  const [bridgeStatus, setBridgeStatus] = useState('disconnected');
  const [bridgeError, setBridgeError] = useState('');

  useEffect(() => {
    if (sourceMode !== 'demo' || !demoRunning) return undefined;
    let step = 0;
    const publish = () => {
      const packets = createDemoPackets(step++, Date.now());
      setDemoPackets(Object.fromEntries(packets.map((frame) => [frame.boardId, frame])));
    };
    publish();
    const timerId = setInterval(publish, 1000);
    return () => clearInterval(timerId);
  }, [sourceMode, demoRunning]);

  useEffect(() => {
    if (sourceMode !== 'bridge') return undefined;
    let stream;
    try {
      setBridgeStatus('connecting');
      setBridgeError('');
      setBridgePackets({});
      stream = new EventSource(bridgeUrl);
    } catch (error) {
      setBridgeStatus('disconnected');
      setBridgeError(error.message);
      return undefined;
    }
    stream.onopen = () => { setBridgeStatus('connected'); setBridgeError(''); };
    stream.onerror = () => {
      setBridgeStatus('disconnected');
      setBridgePackets({});
      setBridgeError('브리지 연결이 끊어졌습니다. 로컬 PC 서버와 주소를 확인하세요.');
    };
    const onPacket = (event) => {
      try {
        const packet = JSON.parse(event.data);
        const issue = validateTelemetryPacket(packet);
        if (issue) throw new Error(issue);
        if (packet.source !== 'PC_TEST' && packet.source !== 'MCU_UART')
          throw new Error('브리지의 데이터 출처가 유효하지 않습니다.');
        setBridgePackets((old) => ({ ...old, [packet.boardId]: packet }));
      } catch (error) {
        setBridgeError(`패킷 거부: ${error.message}`);
      }
    };
    stream.addEventListener('telemetry', onPacket);
    return () => {
      stream.removeEventListener('telemetry', onPacket);
      stream.close();
    };
  }, [sourceMode, bridgeUrl]);


  const [
    simulationEnabled,
    setSimulationEnabled,
  ] = useState(false);

  const [drafts, setDrafts] = useState(initialDrafts);

  const [polarities, setPolarities] =
    useState(initialPolarities);

  // ----------------------------------------------------------
  // Calculate ADC injection results
  // ----------------------------------------------------------

  const manualReports = useMemo(() => {
    if (!simulationEnabled) {
      return {};
    }

    return Object.fromEntries(
      BOARD_IDS.map((id) => {
        const inputs = Object.fromEntries(
          Object.entries(drafts[id]).map(
            ([key, value]) => [
              key,
              parseDraft(value),
            ]
          )
        );

        const currentPolarity =
          Object.fromEntries(
            Object.entries(polarities[id]).map(
              ([key, sign]) => [
                key,
                sign === '' ? null : Number(sign),
              ]
            )
          );

        return [
          id,
          simulateAdcInjection(inputs, {
            currentPolarity,
          }),
        ];
      })
    );
  }, [
    simulationEnabled,
    drafts,
    polarities,
  ]);


  const packets = sourceMode === 'demo' ? demoPackets : bridgePackets;
  const sensorActive = sourceMode === 'manual'
    ? simulationEnabled
    : sourceMode === 'demo' ? demoRunning : bridgeStatus === 'connected';
  const reports = useMemo(() => {
    if (sourceMode === 'manual') return manualReports;
    if (sourceMode === 'demo' && !demoRunning) return {};
    if (sourceMode === 'bridge' && bridgeStatus !== 'connected') return {};
    const next = {};
    for (const [id, packet] of Object.entries(packets)) {
      try {
        // +1 is an explicit BENCH assumption; actual sensor direction
        // is not confirmed until positive-current hardware testing.
        next[id] = packetToReport(packet);
      } catch { /* Reject invalid frame, never display it as measured. */ }
    }
    return next;
  }, [sourceMode, manualReports, packets, demoRunning, bridgeStatus]);

  // ----------------------------------------------------------
  // Selected board measurements
  // ----------------------------------------------------------

  const report = reports[selectedId] ?? null;

  const selectedBoard = createEmptyBoard(selectedId);

  const measurements =
    report?.values ?? selectedBoard.measurements;

  // ----------------------------------------------------------
  // Update manual sensor input
  // ----------------------------------------------------------

  function updateDraft(key, value) {
    setDrafts((old) => ({
      ...old,
      [selectedId]: {
        ...old[selectedId],
        [key]: value,
      },
    }));
  }

  // ----------------------------------------------------------
  // Update assumed current polarity
  // ----------------------------------------------------------

  function updatePolarity(key, value) {
    setPolarities((old) => ({
      ...old,
      [selectedId]: {
        ...old[selectedId],
        [key]: value,
      },
    }));
  }

  // ----------------------------------------------------------
  // Board status label
  // ----------------------------------------------------------

  function boardLabel(id) {
    if (!sensorActive) {
      return '시험 대기';
    }

    const quality = Object.values(
      reports[id]?.quality ?? {}
    );

    if (
      quality.includes('ADC_INPUT_CLIPPED') ||
      quality.includes('ADC_RAIL')
    ) {
      return '센싱 범위 주의';
    }

    return sourceMode === 'manual' ? '센싱 시험 중' : '패킷 수신 중';
  }

  // ----------------------------------------------------------
  // Simple input and output power calculations
  // These are NOT converter plant predictions.
  // ----------------------------------------------------------

  const inputPower =
    report &&
    Number.isFinite(measurements.vpv) &&
    Number.isFinite(measurements.ipv)
      ? measurements.vpv * measurements.ipv
      : null;

  const outputPower =
    report &&
    Number.isFinite(measurements.vdc) &&
    Number.isFinite(measurements.idc)
      ? measurements.vdc * measurements.idc
      : null;

  // ==========================================================
  // Dashboard UI
  // ==========================================================

  return (
    <main className="dashboard">

      {/* 상단 브랜드 / 빠른 이동 */}
      <div className="app-topbar">
        <a className="brand" href="#top" aria-label="올라가조 대시보드 맨 위로 이동">
          <span className="brand-mark" aria-hidden="true">↗</span>
          <span className="brand-copy"><strong>올라가조</strong><small>CAPSTONE DESIGN · PV-CLLC</small></span>
        </a>
        <nav className="quick-nav" aria-label="대시보드 섹션 이동">
          <a href="#integration">통신 시연</a>
          <a href="#boards">보드 현황</a>
          <a href="#sensor-input">센서 입력</a>
          <a href="#sensor-results">측정 결과</a>
          <a href="#protection">보호 시험</a>
          <a href="#history">실시간 그래프</a>
          <a href="#adc-filter">ADC 필터 실험</a>
          <a href="#cooling">냉각 계산</a>
        </nav>
        <span className="top-mode-label">올라가조 프로젝트</span>
      </div>

      <header className="dashboard-header" id="top">
        <div className="hero-copy">
          <p className="eyebrow">CAPSTONE DESIGN <span className="eyebrow-dot">·</span> 올라가조 팀</p>
          <h1>1kW급 PV-CLLC 컨버터를 제어하기 위한<br className="desktop-only" /> 제어보드 제작 및 제어 알고리즘 개발</h1>
          <p className="subtitle">F28388D 기반 통합 모니터링 및 센싱·보호 시뮬레이션</p>
          <p className="hero-description">
            센싱 결과, 보호 상태, 실시간 기록과 주변 온도에 따른 냉각 계산을 한곳에서 확인할 수 있습니다.
          </p>
          <div className="hero-meta" aria-label="프로젝트 구성">
            <span><b>01</b> 센싱 9채널</span>
            <span><b>02</b> 보드 4대</span>
            <span><b>03</b> 보호 상태 시험</span>
          </div>
          <div className="header-actions">
            <button className="simulation-button" type="button"
              aria-pressed={sensorActive}
              onClick={() => sourceMode === 'manual'
                ? setSimulationEnabled((previous) => !previous)
                : sourceMode === 'demo' ? setDemoRunning((previous) => !previous) : undefined}
              disabled={sourceMode === 'bridge'}>
              <span className="play-symbol" aria-hidden="true">{sensorActive ? '■' : '▶'}</span>
              {sourceMode === 'bridge' ? '브리지 수신 자동 제어' : sensorActive ? '센싱 시험 중지' : '센싱 시험 시작'}
            </button>
            <span className={`system-state ${sensorActive ? 'is-running' : ''}`}>
              <span className="state-indicator" />
              {sensorActive ? '데이터 표시 중' : '시험 대기'}
            </span>
          </div>
        </div>

        {/* 실제 회로도라고 주장하지 않는 기능 개념도 */}
        <div className="flow-illustration" aria-label="시스템 기능 개념도">
          <div className="illustration-head">
            <span>시스템 구성도</span><small>FUNCTIONAL OVERVIEW</small>
          </div>
          <svg className="system-svg" viewBox="0 0 540 296" role="img"
            aria-label="태양광 입력에서 CLLC 전력회로를 거쳐 DC 출력으로 이어지는 전력 경로와 센싱 신호, F28388D 제어보드, 웹 모니터링의 개념적 관계">
            <defs>
              <linearGradient id="pvGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3faff"/><stop offset="1" stopColor="#d8e9ff"/></linearGradient>
              <linearGradient id="boardGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eafdf4"/><stop offset="1" stopColor="#c5f1dd"/></linearGradient>
            </defs>
            <text x="16" y="22" className="svg-hint">POWER PATH · 전력 경로 (개념도)</text>
            <rect x="12" y="34" width="145" height="80" rx="13" fill="url(#pvGradient)" stroke="#a8c9ed"/>
            <g stroke="#4e80c2" fill="none" strokeWidth="2.2">
              <rect x="29" y="48" width="37" height="34" rx="3"/><path d="M41 48v34M54 48v34M29 60h37M29 72h37M48 83v9"/>
            </g>
            <text x="82" y="67" className="svg-title">PV 입력</text><text x="82" y="87" className="svg-sub">태양광 전원</text>
            <path d="M162 74h25" className="svg-arrow"/><path d="M182 69l7 5-7 5" className="svg-arrow"/>
            <rect x="195" y="34" width="150" height="80" rx="13" fill="#edf3ff" stroke="#b2c8f7"/>
            <g stroke="#4468d6" strokeWidth="2.3" fill="none"><path d="M214 66q9-17 18 0t18 0"/><path d="M214 85h37"/><path d="M239 80l11 5-11 5"/></g>
            <text x="263" y="66" className="svg-title">CLLC</text><text x="263" y="87" className="svg-sub">전력변환 회로</text>
            <path d="M350 74h24" className="svg-arrow"/><path d="M369 69l7 5-7 5" className="svg-arrow"/>
            <rect x="382" y="34" width="145" height="80" rx="13" fill="#fff8e7" stroke="#e9d098"/>
            <g stroke="#ca8d19" fill="none" strokeWidth="2.4"><path d="M397 61h21v23h-21zM402 56v5M413 56v5M402 84v5M413 84v5"/></g>
            <text x="428" y="67" className="svg-title">DC 출력</text><text x="428" y="87" className="svg-sub">부하 측</text>
            <path d="M269 119v21" className="svg-dash"/><path d="M265 135l4 7 4-7" className="svg-dash"/>
            <rect x="195" y="148" width="150" height="51" rx="10" fill="#fff" stroke="#c9d4e1" strokeDasharray="4 3"/>
            <text x="270" y="168" textAnchor="middle" className="svg-title">전압 · 전류 · 온도</text>
            <text x="270" y="185" textAnchor="middle" className="svg-sub">센싱값 / ADC 경로</text>
            <path d="M269 204v15" className="svg-dash"/><path d="M265 214l4 7 4-7" className="svg-dash"/>
            <rect x="195" y="229" width="150" height="54" rx="11" fill="url(#boardGradient)" stroke="#a3dabb"/>
            <text x="270" y="249" textAnchor="middle" className="svg-title">F28388D 제어보드</text>
            <text x="270" y="268" textAnchor="middle" className="svg-sub">ADC 센싱 · 보호 상태</text>
            <path d="M350 256h23" className="svg-dash"/><path d="M368 251l7 5-7 5" className="svg-dash"/>
            <rect x="382" y="229" width="145" height="54" rx="11" fill="#f5efff" stroke="#d3c1fa"/>
            <text x="454" y="249" textAnchor="middle" className="svg-title">웹 모니터링</text>
            <text x="454" y="268" textAnchor="middle" className="svg-sub">실시간 기록·상태 표시</text>
            <text x="16" y="184" className="svg-note">점선: 기능 관계</text>
            <text x="16" y="200" className="svg-note">시스템 기능 개념도</text>
          </svg>
          <div className="illustration-caption">
            <span className="legend-swatch" /> 전력 경로
            <span className="legend-dash" /> 센싱·제어 개념 흐름
          </div>
        </div>
      </header>

      <section className="integration-panel content-section" id="integration">
        <div className="integration-head">
          <div><p className="section-kicker">FIRMWARE ↔ WEB / INTEGRATION</p>
            <h2>CCS 데이터 규격 · 웹 통합 모니터링</h2>
            <p>CCS v2.3 ADC 채널 매핑과 대응하는 9채널 패킷으로 웹 기능을 검증합니다. 자동 시연은 가상 ADC 데이터이며 MCU 실제 수신이 아닙니다.</p>
          </div>
          <span className="integration-pill">{sourceMode === 'demo' ? 'BROWSER TEST' : sourceMode === 'bridge' ? (packets[selectedId]?.source || 'PC BRIDGE') : 'MANUAL TEST'}</span>
        </div>
        <div className="integration-mode-grid" role="group" aria-label="데이터 원천 선택">
          <button className={sourceMode === 'demo' ? 'integration-mode active' : 'integration-mode'} type="button" onClick={() => setSourceMode('demo')} aria-pressed={sourceMode === 'demo'}>
            <strong>① 자동 펌웨어 규격 시연</strong><small>웹 접속만으로 동작 · 4개 보드 · ADC 9채널</small>
          </button>
          <button className={sourceMode === 'bridge' ? 'integration-mode active' : 'integration-mode'} type="button" onClick={() => setSourceMode('bridge')} aria-pressed={sourceMode === 'bridge'}>
            <strong>② PC 브리지 수신</strong><small>로컬 Node 서버 → SSE 패킷 → React</small>
          </button>
          <button className={sourceMode === 'manual' ? 'integration-mode active' : 'integration-mode'} type="button" onClick={() => setSourceMode('manual')} aria-pressed={sourceMode === 'manual'}>
            <strong>③ 수동 센서 시험</strong><small>기존 입력값 변경 · 보호 시나리오 재현</small>
          </button>
        </div>
        {sourceMode === 'bridge' && <div className="integration-bridge-config">
          <label>로컬 SSE 주소 <input aria-label="브리지 SSE 주소" value={bridgeUrl}
            onChange={(event) => setBridgeUrl(event.target.value)} /></label>
          <strong className={bridgeStatus === 'connected' ? 'integration-success' : 'integration-warning'}>
            {bridgeStatus === 'connected' ? '연결됨' : bridgeStatus === 'connecting' ? '연결 시도 중' : '연결 안 됨'}
          </strong>
          <small>연결 테스트: 웹 폴더에서 <code>npm run bridge</code> 실행. 현재 펌웨어에는 UART 전송 코드가 없어 PC_TEST로 시험됩니다.</small>
          {bridgeError && <small className="integration-warning">{bridgeError}</small>}
        </div>}
        <div className="integration-metrics">
          <div><small>통신 규격</small><strong>pvcllc.telemetry.v1</strong></div>
          <div><small>선택 보드 원시값</small><strong>{report?.rawBySensor ? '9 / 9 채널' : '수신 대기'}</strong></div>
          <div><small>샘플 카운터</small><strong>{report?.packet?.sampleCount?.toLocaleString('ko-KR') ?? '—'}</strong></div>
          <div><small>ADC 실패 누계</small><strong>{report?.packet ? `${report.packet.adcTimeoutCount} timeout / ${report.packet.adcOverflowCount} overflow` : '—'}</strong></div>
          <div><small>제어 출력</small><strong>PFM / MPPT 미구현</strong></div>
        </div>
        <p className="integration-footnote">{sourceMode === 'demo' ? '브라우저에서 생성한 시험 패킷을 1초마다 갱신합니다. BOARD-02는 주기적으로 변압기 과열 상황을 재현합니다.' : sourceMode === 'bridge' ? 'PC_TEST는 브리지의 가상 패킷입니다. MCU_UART 표시만 실제 직렬 포트에서 수신된 패킷을 뜻합니다.' : '수동 모드에서는 기존 센서 입력 및 회로 센싱 환산 시험을 사용합니다.'} 전류 방향 +1은 데모 전용 가정이며 실물 센서는 미보정 상태입니다.</p>
      </section>

      <div className="notice-strip" role="note">
        <span className="notice-icon" aria-hidden="true">ⓘ</span>
        <p><strong>PCB 미도착 · MCU 미연결</strong> — 브라우저 자동 데모와 PC_TEST 브리지는 실제 CCS 펌웨어가 보낸 데이터가 아닙니다. 실제 MCU UART 수신은 전송 펌웨어와 보드 연결 후에만 가능합니다.</p>
      </div>

      {/* ====================================================
          Four-board overview
      ==================================================== */}

      <section id="boards" className="board-section content-section">

        <div className="section-header"><div><p className="section-kicker">01 · BOARD OVERVIEW</p><h2>제어보드 통합 현황</h2><p className="section-subtitle">보드를 선택하면 해당 보드의 센싱 결과와 기록을 확인할 수 있습니다.</p></div><span className="section-count">4 BOARDS</span></div>

        <div className="board-grid">

          {BOARD_IDS.map((id) => (

            <button
              className={`board-card ${
                selectedId === id ? 'selected' : ''
              }`}
              type="button"
              key={id}
              onClick={() => setSelectedId(id)}
              aria-pressed={selectedId === id}
            >

              <span className="board-card-top"><strong>{id}</strong><span className="board-card-arrow" aria-hidden="true">↗</span></span>
              <span className="board-card-status"><span className="state-indicator"/>{boardLabel(id)}</span>
              <span className="board-card-metrics">
                <span>PV <b>{formatNumber(reports[id]?.values?.vpv, 1)} V</b></span>
                <span>DC <b>{formatNumber(reports[id]?.values?.vdc, 1)} V</b></span>
              </span>

            </button>

          ))}

        </div>

      </section>

      {/* ====================================================
          Manual sensor signal injection
      ==================================================== */}

      {sourceMode === 'manual' ? <section className="manual-test-panel content-section" id="sensor-input">

        <div className="manual-test-title">

          <div>

            <h2>
              {selectedId} · 센서 시험값 입력
            </h2>

            <p>
              보드별 시험값은 독립적으로 유지됩니다. 값을 변경하면 ADC 명목 환산 결과가 즉시 갱신됩니다.
            </p>

          </div>

          <span className="manual-test-note">
            센서 입력값을 직접 변경할 수 있습니다
          </span>

        </div>

        {/* 입력 채널은 원래 SENSOR_GROUPS를 그대로 사용하여 묶음만 바꿉니다. */}
        <div className="manual-field-groups">
          {SENSOR_GROUPS.map((group) => (
            <div key={group.title} className="manual-input-group">
              <h3>{group.title}</h3>
              <div className="manual-fields">
                {group.channels.map((channel) => (
                  <label key={channel.key} className="manual-field">
                    <span>{channel.label} <small>({channel.unit})</small></span>
                    <input type="number" step="any" value={drafts[selectedId][channel.key]}
                      onChange={(event) => updateDraft(channel.key, event.target.value)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Current polarity settings */}

        <div className="manual-polarities">

          {['ipv', 'idc'].map((key) => (

            <label key={key}>

              <span>
                {key.toUpperCase()} 전류 방향
                {' '}
                (시험 가정, 실측 검증 전)
              </span>

              <select
                value={polarities[selectedId][key]}
                onChange={(event) =>
                  updatePolarity(
                    key,
                    event.target.value
                  )
                }
              >

                <option value="">
                  미확정 · 전류 환산 보류
                </option>

                <option value="1">
                  +1 (가상 회로 극성 가정)
                </option>

                <option value="-1">
                  -1 (반대 극성 시험)
                </option>

              </select>

            </label>

          ))}

        </div>

        <p className="manual-explanation">

          이 영역은 <strong>독립적인 센서 신호 주입 시험</strong>입니다.
          CLLC 전력 보존, 공진 과도응답 또는 PPO/PFM 제어를 예측하지 않습니다.
          전류 환산값은 시험 방향을 선택한 경우에만 표시됩니다.

        </p>

      </section> : null}

      {sourceMode !== 'manual' && <section className="content-section manual-test-panel" id="sensor-input">
        <h2>자동 패킷 수신 모드</h2>
        <p>현재 모드에서는 센서값을 직접 입력하지 않습니다. 수동값을 변경하려면 위에서 「수동 센서 시험」으로 전환하세요.</p>
      </section>}

      {/* ====================================================
          Sensor measurement results
      ==================================================== */}

      <section className="detail-section content-section" id="sensor-results">

        <div className="section-heading">

          <div><p className="section-kicker">02 · SENSOR MONITORING</p><h2>{selectedId} 센싱 결과</h2></div>

          <span>
            {sensorActive
              ? (sourceMode === 'manual' ? '수동 가상 ADC · 명목 설계값' : '패킷 기반 가상/시험 ADC · 미보정')
              : '시험 대기'}
          </span>

        </div>

        {SENSOR_GROUPS.map((group) => (

          <div
            key={group.title}
            className="sensor-section"
          >

            <h3>{group.title}</h3>

            <div className="sensor-grid">

              {group.channels.map((channel) => (

                <div
                  key={channel.key}
                  className="sensor-card"
                >

                  <span>
                    {channel.label}
                  </span>

                  <strong>
                    {formatNumber(
                      measurements[channel.key]
                    )}
                    {' '}
                    {Number.isFinite(
                      measurements[channel.key]
                    )
                      ? channel.unit
                      : ''}
                  </strong>

                  <small>
                    {report
                      ? (
                          QUALITY_TEXT[
                            report.quality[channel.key]
                          ] ?? '확인 필요'
                        )
                      : '시험 대기'}
                  </small>

                </div>

              ))}

            </div>

          </div>

        ))}

      </section>

      {/* ====================================================
          ADC conversion details
      ==================================================== */}

      <section className="content-section adc-details-section" id="adc-details">
        <details className="adc-disclosure">
          <summary><span><span className="section-kicker">TECHNICAL DETAILS</span><strong>ADC 변환 상세 (시험/수신 데이터)</strong><small>원시값 · 핀 전압 · 복원값 확인</small></span><span className="disclosure-arrow" aria-hidden="true">⌄</span></summary>
        <div className="adc-table-wrap">

          <table className="adc-detail-table">

            <thead>
              <tr>
                <th>신호</th>
                <th>ADC 채널</th>
                <th>입력값</th>
                <th>가상 ADC 핀 전압</th>
                <th>ADC 원시값</th>
                <th>복원값</th>
                <th>품질 / 주의</th>
              </tr>
            </thead>

            <tbody>

              {SENSOR_GROUPS.flatMap(
                (group) =>
                  group.channels.map((channel) => (

                    <tr key={channel.key}>

                      <td>
                        {channel.label}
                      </td>

                      <td>
                        {
                          SENSOR_SPEC[channel.key]
                            .adcInput
                        }
                      </td>

                      <td>
                        {
                          sourceMode === 'manual' ? drafts[selectedId][channel.key] : '패킷 수신'
                        }
                        {' '}
                        {channel.unit}
                      </td>

                      <td>
                        {formatNumber(
                          report?.adcPinVoltageV?.[
                            channel.key
                          ],
                          4
                        )}
                        {' '}
                        V
                      </td>

                      <td>
                        {
                          report?.rawBySensor?.[
                            channel.key
                          ] ?? '—'
                        }
                        {' '}
                        / 4095
                      </td>

                      <td>
                        {formatNumber(
                          measurements[channel.key],
                          3
                        )}
                        {' '}
                        {channel.unit}
                      </td>

                      <td>
                        {report
                          ? (
                              QUALITY_TEXT[
                                report.quality[
                                  channel.key
                                ]
                              ] ?? '확인 필요'
                            )
                          : '시험 대기'}
                      </td>

                    </tr>

                  ))
              )}

            </tbody>

          </table>
        </div>
        </details>
      </section>

      {/* ====================================================
          Simple power calculations and control status
      ==================================================== */}

      <section className="content-section power-section" id="power-status">
        <div className="section-header"><div><p className="section-kicker">03 · POWER SNAPSHOT</p><h2>전력 계산 및 제어 상태</h2></div></div>

        <div className="sensor-grid">

          <div className="sensor-card">

            <span>
              입력전력 (단순 Vpv × Ipv)
            </span>

            <strong>
              {formatNumber(inputPower)}
              {' '}
              {Number.isFinite(inputPower)
                ? 'W'
                : ''}
            </strong>

            <small>
              전류 시험 방향이 지정된 경우에만 계산
            </small>

          </div>

          <div className="sensor-card">

            <span>
              출력전력 (단순 Vdc × Idc)
            </span>

            <strong>
              {formatNumber(outputPower)}
              {' '}
              {Number.isFinite(outputPower)
                ? 'W'
                : ''}
            </strong>

            <small>
              독립 입력값의 곱으로 계산
            </small>

          </div>

          <div className="sensor-card">

            <span>
              PFM 주파수 · 제어 알고리즘
            </span>

            <strong>{report?.packet?.switchingFrequencyHz ? `${(report.packet.switchingFrequencyHz/1000).toFixed(1)} kHz` : '미연동'}</strong>

            <small>
              제어 모델 검증 후 연동 예정
            </small>

          </div>

          <div className="sensor-card">

            <span>
              MCU PWM · 보호 상태
            </span>

            <strong>{report?.packet ? (report.packet.pwmEnabled ? 'MCU PWM ON (수신값)' : 'PWM OFF / 미구현') : '확인 불가'}</strong>

            <small>펌웨어 전송 미구현 · 테스트 패킷에서는 PWM OFF</small>

          </div>

        </div>

      </section>

      {/* ====================================================
          Real-time ADC sensor history
          New feature:
          - Board-specific time history
          - Voltage/current/temperature charts
          - CSV export
      ==================================================== */}

      {/* 보호 시험이 핵심 시연 기능이므로 그래프보다 앞에 배치합니다. */}
      <div id="protection"><ProtectionPanel
        reports={reports}
        simulationEnabled={sensorActive}
        selectedId={selectedId}
      /></div>

      <div id="history"><SensorHistory
        reports={reports}
        simulationEnabled={sensorActive}
        selectedId={selectedId}
      /></div>

      <div id="adc-filter"><AdcFilterLab selectedId={selectedId} /></div>

      <div id="cooling"><CoolingPanel
        report={report}
        simulationEnabled={sensorActive}
        selectedId={selectedId}
      /></div>

      {/* Footer - keep only one footer */}
      <footer className="dashboard-footer">
        <span><strong>올라가조</strong> · 1kW급 PV-CLLC 컨버터 제어보드 및 제어 알고리즘 개발</span>
        <span>F28388D · 4개 보드 · 9채널 센싱 · 보호 상태 · 냉각 계산</span>
      </footer>

    </main>
  );
}

export default App;
