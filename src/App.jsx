
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
import './WorkspaceUI.css';
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
  // UI-only navigation. All experimental components remain mounted when hidden,
  // so switching pages never clears protection history, graphs or form drafts.
  const [activePage, setActivePage] = useState('home');
  const [viewStage, setViewStage] = useState('setup');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const NAV_ITEMS = [
    { id: 'home', label: '홈 · 전체 개요', icon: '⌂', group: 'OVERVIEW' },
    { id: 'integration', label: '데이터 연결', icon: '⇄', group: 'WORKSPACE' },
    { id: 'boards', label: '보드 현황', icon: '▦', group: 'WORKSPACE' },
    { id: 'manual', label: '수동 센서 시험', icon: '◫', group: 'EXPERIMENTS' },
    { id: 'protection', label: '보호 기능 시험', icon: '◇', group: 'EXPERIMENTS' },
    { id: 'filter', label: 'ADC 필터 실험', icon: '≋', group: 'EXPERIMENTS' },
    { id: 'cooling', label: '냉각 계산', icon: '◷', group: 'EXPERIMENTS' },
    { id: 'measurements', label: '센싱 · 전력 분석', icon: '▤', group: 'ANALYSIS' },
    { id: 'history', label: '실시간 그래프', icon: '⌁', group: 'ANALYSIS' },
  ];
  const PAGE_HINTS = {
    home: ['한눈에 보는 통합 시험', '시연할 실험을 고르고, 보드를 선택해 시작하세요.'],
    integration: ['데이터 연결', '가상 데이터 · PC 브리지 · 수동 입력 모드를 선택하세요.'],
    boards: ['보드 현황', '4개 보드의 센싱 상태를 비교하고 분석할 보드를 선택하세요.'],
    manual: ['수동 센서 시험', '조건을 설정하고 시험을 시작한 뒤 결과를 확인하세요.'],
    protection: ['보호 기능 시험', '보호 기준 설정과 FAULT 판단 및 복귀 기록을 확인하세요.'],
    filter: ['ADC 필터 실험', '채널 · 노이즈 · EMA 설정과 필터 반응을 비교하세요.'],
    cooling: ['냉각 계산', '주변 온도와 시정수를 입력하고 계산 결과를 확인하세요.'],
    measurements: ['센싱 · 전력 분석', '선택한 보드의 9채널 측정값과 환산 품질을 확인하세요.'],
    history: ['실시간 그래프', '시간에 따른 센싱 값 변화와 CSV 기록을 확인하세요.'],
  };
  const EXPERIMENT_PAGES = ['manual', 'protection', 'filter', 'cooling'];
  function navigate(page) {
    setActivePage(page);
    setViewStage('setup');
    setSidebarOpen(false);
    if (page === 'manual') setSourceMode('manual');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function pageClass(page) {
    return `workspace-page ${activePage === page ? 'is-active' : ''} ${viewStage === 'results' ? 'stage-results' : 'stage-setup'}`;
  }
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
    <main className="dashboard dashboard-v26">

      <div className="workspace-shell">
        <aside className={`workspace-sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="기능별 메뉴">
          <button type="button" className="sidebar-brand" onClick={() => navigate('home')}>
            <span className="sidebar-symbol" aria-hidden="true">↗</span>
            <span className="sidebar-brand-name"><strong>올라가조</strong><small>PV-CLLC CONTROL LAB</small></span>
          </button>
          <div className="sidebar-label">CONTROL WORKSPACE <span>v2.6</span></div>
          <nav className="sidebar-navigation" aria-label="실험과 분석 메뉴">
            {NAV_ITEMS.map((item, i) => (
              <div key={item.id}>
                {(i === 0 || NAV_ITEMS[i - 1].group !== item.group) && <div className="nav-group-label">{item.group}</div>}
                <button type="button" className={`sidebar-link ${activePage === item.id ? 'active' : ''}`} aria-current={activePage === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}>
                  <span className="sidebar-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
                  {activePage === item.id && <span className="sidebar-current" aria-hidden="true" />}
                </button>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom"><div className="sidebar-device"><span className="device-led"/><strong>F28388D</strong><small>PCB 미연결 · 시뮬레이션</small></div><p>실제 센서 측정값이 아닌 개발·시험용 데이터입니다.</p></div>
        </aside>
        {sidebarOpen && <button type="button" className="sidebar-backdrop" aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)} />}
        <div className="workspace-main">
          <header className="workspace-toolbar">
            <div className="toolbar-left"><button className="mobile-menu-button" type="button" aria-label="메뉴 열기" onClick={() => setSidebarOpen(true)}>☰</button>
              <span className="toolbar-breadcrumb">WORKSPACE <span>/</span> {PAGE_HINTS[activePage][0]}</span></div>
            <div className="toolbar-actions">
              <span className="toolbar-source">{sourceMode === 'demo' ? 'BROWSER DEMO' : sourceMode === 'manual' ? 'MANUAL TEST' : (packets[selectedId]?.source || 'PC BRIDGE')}</span>
              <label className="toolbar-board-select"><span>보드</span><select aria-label="현재 작업 보드" value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
                {BOARD_IDS.map(id=><option value={id} key={id}>{id}</option>)}
              </select></label>
              <button type="button" className={`toolbar-run ${sensorActive ? 'is-running' : ''}`} disabled={sourceMode === 'bridge'}
                onClick={() => sourceMode === 'manual' ? setSimulationEnabled(old => !old) : setDemoRunning(old => !old)}>
                {sourceMode === 'bridge' ? '브리지 수신' : sensorActive ? '■ 시험 중지' : '▶ 시험 시작'}
              </button>
              <span className={`toolbar-connection ${sensorActive ? 'is-on' : ''}`}><i />{sensorActive ? '시험 데이터 표시 중' : '시험 대기'}</span>
            </div>
          </header>
          <div className="workspace-inner">
            <div className="workspace-page-heading">
              <div><p className="workspace-eyebrow">CAPSTONE DESIGN / TEST CONSOLE</p><h1>{PAGE_HINTS[activePage][0]}</h1><p>{PAGE_HINTS[activePage][1]}</p></div>
              <div className="workspace-page-actions">
                {activePage !== 'home' && <button type="button" className="button-quiet" onClick={()=>navigate('home')}>← 홈으로</button>}
                {EXPERIMENT_PAGES.includes(activePage) && <button type="button" className="button-quiet" onClick={()=>setViewStage('setup')}>↺ 다시 설정</button>}
              </div>
            </div>
            {EXPERIMENT_PAGES.includes(activePage) && <div className="workflow-bar" role="group" aria-label="시험 단계">
              <button type="button" className={`workflow-tab ${viewStage === 'setup' ? 'is-current' : ''}`} onClick={()=>setViewStage('setup')} aria-pressed={viewStage === 'setup'}><span>01</span> 조건 설정</button>
              <span className="workflow-arrow">→</span>
              <button type="button" className={`workflow-tab ${viewStage === 'results' ? 'is-current' : ''}`} onClick={()=>setViewStage('results')} aria-pressed={viewStage === 'results'}><span>02</span> 결과 확인</button>
              {viewStage === 'setup' && <button type="button" className="workflow-next" onClick={()=>setViewStage('results')}>결과 확인 →</button>}
              {viewStage === 'results' && <button type="button" className="workflow-next" onClick={()=>setViewStage('setup')}>설정으로 돌아가기 ↺</button>}
            </div>}
            <div className="workspace-page is-active home-page" style={{display:activePage==='home'?'block':'none'}}>
              <section className="home-hero">
                <div className="home-hero-left"><span className="home-kicker">올라가조 / 1kW PV–CLLC</span><h2>제어보드 통합 시험<br/>워크스페이스</h2><p>전압·전류·온도 센싱부터 보호 판단, ADC 필터 반응, 냉각 분석까지. 원하는 시험을 선택하면 설정 화면으로 바로 이동합니다.</p>
                  <div className="home-hero-actions"><button type="button" className="button-primary" onClick={()=>navigate('manual')}>실험 시작하기 <span>↗</span></button><button type="button" className="button-outline" onClick={()=>navigate('boards')}>4개 보드 보기</button></div>
                </div>
                <div className="home-hero-right"><div className="home-stats-kicker">SYSTEM AT A GLANCE</div><div className="home-stat-grid"><div><strong>04</strong><span>모니터링 보드</span></div><div><strong>09</strong><span>ADC 센서 채널</span></div><div><strong>1ms</strong><span>펌웨어 설정 주기</span></div><div><strong>100ms</strong><span>웹용 스냅샷 설계</span></div></div><p>가상 시험 데이터 · PWM/PFM 실제 제어 미연결</p></div>
              </section>
              <div className="home-section-heading"><div><h3>어떤 시험을 진행할까요?</h3><p>기능을 선택하면 해당 설정 화면으로 이동합니다.</p></div><span>6 TEST MODULES</span></div>
              <div className="home-launch-grid">
                {[
                  {id:'integration',num:'01',icon:'⇄',title:'데이터 연결',desc:'자동 시연 · PC 브리지 · 수동 모드',tone:'cyan'},
                  {id:'manual',num:'02',icon:'◫',title:'수동 센서 시험',desc:'9채널 입력값 변경 및 측정 결과',tone:'blue'},
                  {id:'protection',num:'03',icon:'◇',title:'보호 기능 시험',desc:'과전압 · 과전류 · 과열 · 복귀',tone:'orange'},
                  {id:'filter',num:'04',icon:'≋',title:'ADC 필터 실험',desc:'원시 ADC ↔ EMA 반응 비교',tone:'violet'},
                  {id:'cooling',num:'05',icon:'◷',title:'냉각 계산',desc:'주변 온도별 온도 변화 그래프',tone:'teal'},
                  {id:'history',num:'06',icon:'⌁',title:'실시간 그래프',desc:'보드별 시간 이력 · CSV 저장',tone:'indigo'},
                ].map(item=><button type="button" key={item.id} className={`launch-card launch-${item.tone}`} onClick={()=>navigate(item.id)}>
                  <span className="launch-icon" aria-hidden="true">{item.icon}</span><span className="launch-text"><small>MODULE {item.num}</small><strong>{item.title}</strong><span>{item.desc}</span></span><span className="launch-arrow" aria-hidden="true">↗</span>
                </button>)}
              </div>
              <div className="home-bottom-strip"><span className="home-warning-dot"/><strong>개발·검증 상태</strong><span>가상 데이터 전용 · 실제 PCB 미연결 · 제어 출력은 아직 연동되지 않았습니다.</span></div>
            </div>
            <div className={pageClass('integration')}>
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

            </div>
      {/* ====================================================
          Four-board overview
      ==================================================== */}

      <div className={pageClass('boards')}>
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

      </div>

      {/* ====================================================
          Manual sensor signal injection
      ==================================================== */}

      <div className={pageClass('manual')}>
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

      <div className="manual-preview-results" aria-live="polite">
        <div className="manual-preview-heading"><div><p className="section-kicker">MEASUREMENT PREVIEW</p><h2>{selectedId} · 측정 결과 요약</h2><p>수동 입력된 센서값의 환산 결과입니다. 보호 판정을 보려면 보호 기능 시험 메뉴를 선택하세요.</p></div><button type="button" className="button-outline" onClick={()=>navigate('measurements')}>9채널 상세 분석 ↗</button></div>
        <div className="manual-preview-grid">{SENSOR_GROUPS.flatMap(group => group.channels).map(channel=><div className="manual-preview-tile" key={channel.key}><span>{channel.label}</span><strong>{formatNumber(measurements[channel.key])} <small>{Number.isFinite(measurements[channel.key])?channel.unit:''}</small></strong><em>{report ? (QUALITY_TEXT[report.quality[channel.key]] ?? '확인 필요') : '시험 대기'}</em></div>)}</div>
      </div>
      </div>

      {/* ====================================================
          Sensor measurement results
      ==================================================== */}

      <div className={pageClass('measurements')}>
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

      </div>

      {/* ====================================================
          Real-time ADC sensor history
          New feature:
          - Board-specific time history
          - Voltage/current/temperature charts
          - CSV export
      ==================================================== */}

      {/* 보호 시험이 핵심 시연 기능이므로 그래프보다 앞에 배치합니다. */}
      <div className={pageClass('protection')}>
        <div className="protect-workflow-help"><div><strong>이상 상황을 직접 만들고 싶나요?</strong><span>수동 센서 시험에서 PV 전압·전류·온도를 변경하면 이 화면의 보호 판정에 반영됩니다.</span></div><button className="button-outline" type="button" onClick={()=>navigate('manual')}>센서값 설정 ↗</button></div>
        <div id="protection"><ProtectionPanel
        reports={reports}
        simulationEnabled={sensorActive}
        selectedId={selectedId}
      /></div>

      </div>
      <div className={pageClass('history')}><div id="history"><SensorHistory
        reports={reports}
        simulationEnabled={sensorActive}
        selectedId={selectedId}
      /></div>

      </div>
      <div className={pageClass('filter')}><div id="adc-filter"><AdcFilterLab selectedId={selectedId} /></div>

      </div>
      <div className={pageClass('cooling')}><div id="cooling"><CoolingPanel
        report={report}
        simulationEnabled={sensorActive}
        selectedId={selectedId}
      /></div>

      </div>
      {/* Footer - keep only one footer */}
      <footer className="dashboard-footer">
        <span><strong>올라가조</strong> · 1kW급 PV-CLLC 컨버터 제어보드 및 제어 알고리즘 개발</span>
        <span>F28388D · 4개 보드 · 9채널 센싱 · 보호 상태 · 냉각 계산</span>
      </footer>
        </div>
        </div>
      </div>
    </main>
  );
}

export default App;
