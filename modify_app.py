from pathlib import Path
p=Path('/mnt/data/ollagajo_work/src/App.jsx')
s=p.read_text()
s=s.replace("import { useMemo, useState } from 'react';", "import { useEffect, useMemo, useState } from 'react';")
s=s.replace("import CoolingPanel from './components/CoolingPanel';", "import CoolingPanel from './components/CoolingPanel';\nimport { createDemoPackets } from './integration/demoPackets';\nimport { packetToReport, validateTelemetryPacket } from './integration/protocol';")
s=s.replace("  CONVERSION_INVALID: '환산 불가',", "  CONVERSION_INVALID: '환산 불가',\n  CURRENT_DIRECTION_UNCONFIRMED: '전류 방향 미확정',\n  INVALID_RAW: '원시 ADC 입력 오류',\n  ADC_INVALID: 'ADC 측정 실패',")
needle="""  const [selectedId, setSelectedId] = useState(
    BOARD_IDS[0]
  );
"""
assert needle in s
s=s.replace(needle,needle+"""
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

""")
needle="""  const reports = useMemo(() => {
    if (!simulationEnabled) {
      return {};
    }
"""
assert needle in s
s=s.replace("  const reports = useMemo(() => {", "  const manualReports = useMemo(() => {",1)
needle="""  }, [
    simulationEnabled,
    drafts,
    polarities,
  ]);
"""
assert needle in s
s=s.replace(needle,needle+"""

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
""")
# only after that replace simulationEnabled in target references not original state/manualReports
start=s.index('  // ----------------------------------------------------------\n  // Selected board measurements')
part=s[start:]
part=part.replace("if (!simulationEnabled) {\n      return '시험 대기';", "if (!sensorActive) {\n      return '시험 대기';")
part=part.replace("    return '센싱 시험 중';", "    return sourceMode === 'manual' ? '센싱 시험 중' : '패킷 수신 중';")
# UI run button should toggle based on selected mode
part=part.replace("aria-pressed={simulationEnabled}\n              onClick={() => setSimulationEnabled((previous) => !previous)}", "aria-pressed={sensorActive}\n              onClick={() => sourceMode === 'manual'\n                ? setSimulationEnabled((previous) => !previous)\n                : sourceMode === 'demo' ? setDemoRunning((previous) => !previous) : undefined}\n              disabled={sourceMode === 'bridge'}")
part=part.replace("{simulationEnabled ? '■' : '▶'}", "{sensorActive ? '■' : '▶'}")
part=part.replace("{simulationEnabled ? '센싱 시험 중지' : '센싱 시험 시작'}", "{sourceMode === 'bridge' ? '브리지 수신 자동 제어' : sensorActive ? '센싱 시험 중지' : '센싱 시험 시작'}")
part=part.replace("${simulationEnabled ? 'is-running' : ''}", "${sensorActive ? 'is-running' : ''}")
part=part.replace("{simulationEnabled ? '시험 실행 중' : '시험 대기'}", "{sensorActive ? '데이터 표시 중' : '시험 대기'}")
# content displays based on any active source
part=part.replace("{simulationEnabled\n              ? '가상 ADC 신호 · 명목 설계값'", "{sensorActive\n              ? (sourceMode === 'manual' ? '수동 가상 ADC · 명목 설계값' : '패킷 기반 가상/시험 ADC · 미보정')")
part=part.replace("reports={reports}\n        simulationEnabled={simulationEnabled}", "reports={reports}\n        simulationEnabled={sensorActive}")
part=part.replace("report={report}\n        simulationEnabled={simulationEnabled}", "report={report}\n        simulationEnabled={sensorActive}")
# manual section elements: conditional display instead of editable while auto
part=part.replace('      <section className="manual-test-panel content-section" id="sensor-input">', '      {sourceMode === \'manual\' ? <section className="manual-test-panel content-section" id="sensor-input">')
part=part.replace('      {/* ====================================================\n          Sensor measurement results', '      <section className="content-section manual-test-panel" id="sensor-input"\n        style={{display: sourceMode === \'manual\' ? \'none\' : \'block\'}}>\n        <h2>자동 패킷 수신 모드</h2>\n        <p>현재 모드에서는 센서값을 직접 입력하지 않습니다. 수동값을 변경하려면 위에서 「수동 센서 시험」으로 전환하세요.</p>\n      </section>\n\n      {/* ====================================================\n          Sensor measurement results')
# fix conditional close after original manual section
part=part.replace('      </section>\n\n      <section className="content-section manual-test-panel" id="sensor-input"', '      </section> : null}\n\n      <section className="content-section manual-test-panel" id="sensor-input"')
# technical table input value
part=part.replace("          <summary><span><span className=\"section-kicker\">TECHNICAL DETAILS</span><strong>가상 ADC 변환 상세</strong>", "          <summary><span><span className=\"section-kicker\">TECHNICAL DETAILS</span><strong>ADC 변환 상세 (시험/수신 데이터)</strong>")
part=part.replace("                          drafts[selectedId][channel.key]\n                        }", "                          sourceMode === 'manual' ? drafts[selectedId][channel.key] : '패킷 수신'\n                        }")
part=part.replace("                          report?.rawBySensor[\n                            channel.key\n                          ] ?? '—'", "                          report?.rawBySensor?.[\n                            channel.key\n                          ] ?? '—'")
part=part.replace("                          report?.adcPinVoltageV[\n                            channel.key\n                          ]", "                          report?.adcPinVoltageV?.[\n                            channel.key\n                          ]")
# Replace hard coded controls
part=part.replace("            <strong>미연동</strong>", "            <strong>{report?.packet?.switchingFrequencyHz ? `${(report.packet.switchingFrequencyHz/1000).toFixed(1)} kHz` : '미연동'}</strong>")
part=part.replace("            <strong>확인 불가</strong>", "            <strong>{report?.packet ? (report.packet.pwmEnabled ? 'MCU PWM ON (수신값)' : 'PWM OFF / 미구현') : '확인 불가'}</strong>")
# lower text - label mode
part=part.replace("            <small>\n              펌웨어 상태 수신 대기\n            </small>", "            <small>펌웨어 전송 미구현 · 테스트 패킷에서는 PWM OFF</small>")
# strip clarify
part=part.replace("<p><strong>현재 시뮬레이션 모드 · 제어보드 미연결</strong> — 센싱값·보호 상태·냉각 곡선은 시험 입력과 계산 모델을 바탕으로 표시됩니다. 1kW는 과제 목표 용량입니다.</p>", "<p><strong>PCB 미도착 · MCU 미연결</strong> — 브라우저 자동 데모와 PC_TEST 브리지는 실제 CCS 펌웨어가 보낸 데이터가 아닙니다. 실제 MCU UART 수신은 전송 펌웨어와 보드 연결 후에만 가능합니다.</p>")
s=s[:start]+part
# insert integration panel right before notice
needle='''      <div className="notice-strip" role="note">'''
assert needle in s
panel='''      <section className="integration-panel content-section" id="integration">
        <div className="integration-head">
          <div><p className="section-kicker">FIRMWARE ↔ WEB / INTEGRATION</p>
            <h2>CCS 데이터 규격 · 웹 통합 모니터링</h2>
            <p>CCS v2.2.1 ADC 채널 매핑과 대응하는 9채널 패킷으로 웹 기능을 검증합니다. 자동 시연은 가상 ADC 데이터이며 MCU 실제 수신이 아닙니다.</p>
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

'''
s=s.replace(needle,panel+needle)
# adjust sourceMode references? original boardLabel uses report when mode demo but sim flag check changed.
# manual-to-auto status, original click simulation toggles disabled bridge
p.write_text(s)
print('new App lines',s.count('\n'))
