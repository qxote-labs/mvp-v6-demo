// npm run serve 없이 `npm test`만으로 정적 서버 기동 + 8개 시나리오 순차 실행 + 결과 요약까지 처리한다.
const path = require('path');
const { spawn } = require('child_process');
const httpServer = require('http-server');

const ROOT = path.join(__dirname, '..');
const PORT = 8000;

const TEST_FILES = [
  'test_input_stability.js',
  'test_interested_car_handoff.js',
  'test_messaging.js',
  'test_booking_approval.js',
  'test_karmaster_shop_monitor.js',
  'test_unregistered_karmaster_onboarding.js',
  'test_full_service_flow.js',
  'test_no_service_flow.js',
  'test_admin_fasttrack.js',
];

// child_process.spawn(비동기)을 써야 한다. spawnSync는 이벤트 루프를 블로킹해서,
// 같은 프로세스에서 떠 있는 http-server가 그동안 요청을 하나도 처리하지 못하게 된다.
function runTest(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    child.on('close', code => resolve(code));
  });
}

async function main() {
  const server = httpServer.createServer({ root: ROOT, cache: -1 });
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`정적 서버 시작: http://localhost:${PORT}\n`);

  const results = [];
  for (const file of TEST_FILES) {
    console.log(`=== ${file} ===`);
    const code = await runTest(file);
    console.log('');
    results.push({ file, code });
  }

  server.close();

  console.log('=== 결과 요약 ===');
  let failed = false;
  for (const { file, code } of results) {
    const ok = code === 0;
    if (!ok) failed = true;
    console.log(`${ok ? '✅' : '❌'} ${file}`);
  }

  process.exitCode = failed ? 1 : 0;
}

main();
