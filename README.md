# 올라가조 · PV-CLLC 웹/CCS 통합 시연 v2.3

F28388D 기반 1 kW급 PV-CLLC 컨버터 제어보드 프로젝트. **실제 보드와 CCS ADC 실행 결과가 연결된 상태가 아닙니다.** 기존 React 4개 보드, ADC 9채널, 보호 상태, 그래프, 냉각 기능을 보존하면서 동일한 센서 데이터 패킷 규격으로 브라우저 데모와 로컬 PC 브리지를 추가했습니다.

## Windows에서 실행 (VS Code 터미널)

기존 웹 폴더를 반드시 별도 백업한 뒤 새 ZIP의 파일을 웹 폴더에 병합/교체하세요. `node_modules`, `.git` 폴더는 교체하지 않습니다.

```powershell
cd C:\Users\ueuin\Documents\PV_CLLC_Project\web
npm.cmd install
npm.cmd run dev
```

브라우저의 주소(대개 http://localhost:5173)에 접속하면 **① 자동 펌웨어 규격 시연**이 시작됩니다. 각 보드에서 ADC 9채널이 1초마다 변화하며, BOARD-02는 약 19초 후 변압기 과열 시험을 재현합니다. 보호 래치는 사용자가 조건을 회복하고 **시험 보호 복귀 요청**을 눌러야 해제됩니다. 웹의 보호는 가상 소프트웨어 판정일 뿐 실제 PWM을 차단하지 않습니다.

### ② 로컬 PC 브리지 통신 시험

다른 VS Code 터미널을 열어 다음을 실행합니다.

```powershell
cd C:\Users\ueuin\Documents\PV_CLLC_Project\web
npm.cmd run bridge
```

브라우저에서 `② PC 브리지 수신`을 선택하면 SSE로 PC_TEST ADC 패킷 4개/초가 수신됩니다. 브리지 수신의 정상 동작을 확인하려면 브라우저를 같은 PC의 Vite 주소에서 실행하세요. `http://127.0.0.1:8765/health`에서도 서버 상태를 확인할 수 있습니다.

**중요:** 이 브리지의 기본 데이터는 Node가 만든 `PC_TEST` 가상 ADC 패킷입니다. CCS 펌웨어는 아직 직렬 통신 데이터를 송신하지 않습니다.

### ③ 수동 센서 시험

기존의 `수동 센서 시험` 메뉴에서 보드별 입력값, 전류 극성 가정, 보호 임계값, 그래프, 냉각 계산을 그대로 사용할 수 있습니다. 자동 데모와 PC_TEST 브리지는 전류 방향을 +1로 가정하지만, 실제 MCU_UART 수신에서는 극성을 가정하지 않아 전류 및 관련 보호 판정을 미확정으로 표시합니다.

## 프로젝트 검사

```powershell
npm.cmd run test
npm.cmd run lint
npm.cmd run build
```

Node 20.19+/22.12+ 등 설치된 Vite 8 요구 환경을 확인하세요.

## GitHub Pages

`.github/workflows/pages.yml` 파일이 포함되어 있습니다. 저장소에 push한 후 GitHub **Settings → Pages → Build and deployment: GitHub Actions**로 설정해야 배포가 실행됩니다. 실제 배포 여부는 GitHub Actions 로그 및 Pages 링크로 별도 확인해야 합니다.

팀원이 Github Pages로 접속하면 **① 자동 시연**은 실행할 수 있습니다. `② PC 브리지`는 접속한 사람의 로컬 컴퓨터에 서버가 없으면 연결되지 않으며 공개 사이트가 네 PC의 서버에 자동 연결되는 것이 아닙니다.

## CCS 펌웨어와의 관계

`firmware/empty_driverlib_main_ADC_v2_2_1.c.txt`는 이전에 작업한 MCU ADC v2.2.1 코드를 **참고용 텍스트로만 보관한 것**입니다. CCS 프로젝트에 추가하거나 중복 컴파일하지 마세요. 그 코드는 ADCA/ADCD ADC 9채널·1 ms CPU Timer polling·ADC 필터·오류 카운터까지이며 SCI/RS-485 전송, MCU PWM/MPPT/보호 작동 구현은 아직 아닙니다.

PCB가 도착하면 MCU 측에서 `docs/TELEMETRY_PROTOCOL.md` 규격에 맞춰 JSON Lines 직렬 전송을 구현하고, 브리지에 `serialport` npm 패키지를 설치한 뒤 포트를 설정해 실제 프레임을 받을 수 있습니다. UART 브리지 경로는 미실증 상태입니다.
