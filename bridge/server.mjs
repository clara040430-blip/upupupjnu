/**
 * Read-only, loopback-only SSE bridge, no npm packages required for demo mode.
 * Run: node bridge/server.mjs
 * Simulated packets: PC_TEST (never claimed to be from F28388D).
 * Optional UART: install `serialport` separately; set PVCLLC_SERIAL_PORT=COM5.
 * UART mode expects 1 JSON telemetry packet per newline, schema v1.
 * NOTE: v2.2.1 ADC firmware does not yet transmit any UART packets.
 */
import http from 'node:http';
import { createDemoPackets } from '../src/integration/demoPackets.js';
import { validateTelemetryPacket } from '../src/integration/protocol.js';

const port = Number(process.env.PVCLLC_BRIDGE_PORT || 8765);
const address = '127.0.0.1';
const serialPortName = process.env.PVCLLC_SERIAL_PORT || '';
const baudRate = Number(process.env.PVCLLC_BAUD || 115200);
const clients = new Set();
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://clara040430-blip.github.io',
]);
let frameTotal = 0;
let droppedFrames = 0;
let serialStatus = serialPortName ? 'CONNECTING' : 'PC_TEST';

const publish = (packet) => {
  const data = `event: telemetry\ndata: ${JSON.stringify(packet)}\n\n`;
  for (const client of clients) {
    try { client.write(data); } catch { clients.delete(client); }
  }
  frameTotal += 1;
};

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    res.writeHead(403).end('Origin not allowed');
    return;
  }
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  if (req.method !== 'GET') { res.writeHead(405, cors).end(); return; }
  if (req.url === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ server: 'ollagajo-bridge', source: serialPortName ? 'UART' : 'PC_TEST', serialStatus, frameTotal, droppedFrames }));
    return;
  }
  if (req.url !== '/events') { res.writeHead(404, cors).end('Not found'); return; }
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

async function startSerial() {
  let SerialPort;
  try { ({ SerialPort } = await import('serialport')); }
  catch {
    serialStatus = 'MISSING_SERIALPORT_PACKAGE';
    console.error('serialport 패키지가 없습니다. UART 수신은 npm install serialport 후 실행하세요.');
    return;
  }
  const serial = new SerialPort({ path: serialPortName, baudRate, autoOpen: false });
  let partial = '';
  serial.on('data', (buffer) => {
    partial += buffer.toString('utf8');
    if (partial.length > 32768) { partial = ''; droppedFrames++; return; }
    let newline;
    while ((newline = partial.indexOf('\n')) !== -1) {
      const line = partial.slice(0, newline).trim();
      partial = partial.slice(newline + 1);
      if (!line) continue;
      try {
        const packet = JSON.parse(line);
        packet.source = 'MCU_UART'; // Source is the observed transport, not a device claim.
        packet.timestampMs = Date.now(); // PC receive time; MCU RTC not required.
        if (validateTelemetryPacket(packet)) { droppedFrames++; continue; }
        publish(packet);
      } catch { droppedFrames++; }
    }
  });
  serial.on('error', (error) => { serialStatus = 'ERROR'; console.error('UART 오류:', error.message); });
  serial.on('close', () => { serialStatus = 'CLOSED'; console.log('UART 연결 종료'); });
  serial.open((error) => {
    if (error) { serialStatus = 'ERROR'; console.error('UART 열기 실패:', error.message); }
    else { serialStatus = 'CONNECTED'; console.log(`UART 수신: ${serialPortName} @ ${baudRate}`); }
  });
}

server.listen(port, address, () => {
  console.log(`올라가조 SSE 브리지: http://${address}:${port}/health`);
  console.log(serialPortName ? '실제 UART 입력 대기 (펌웨어 전송 구현 필요)' : 'PC_TEST 가상 ADC 패킷 전송 중 (실물 MCU 미연결)');
});

if (serialPortName) {
  startSerial();
} else {
  let step = 0;
  setInterval(() => {
    step += 1;
    for (const packet of createDemoPackets(step, Date.now(), 'PC_TEST')) publish(packet);
  }, 1000);
}
setInterval(() => {
  for (const client of clients) {
    try { client.write(': heartbeat\n\n'); }
    catch { clients.delete(client); }
  }
}, 15000);
