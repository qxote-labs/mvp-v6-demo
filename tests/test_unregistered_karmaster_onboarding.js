// 고객이 상담한 카마스터가 아직 이 서비스에 등록되어 있지 않은 경우를 검증한다. 고객은 이미 체결한
// 계약의 차량정보와 그 카마스터의 연락처를 그대로 입력해 계약내역을 등록하고(조회번호 발급), 그 번호를
// 오프라인으로 전달받은 신규 카마스터는 "비가입자 로그인"(전화번호+계약번호+조회번호)으로 가입 없이
// 그 계약을 확인·승인할 수 있어야 한다. 차량정보는 고객이 이미 입력했으므로 카마스터는 다시 입력하지 않는다.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (page, tag) => {
    page.on('pageerror', e => errors.push(`[${tag}] PAGEERROR: ` + e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`[${tag}] CONSOLE: ` + msg.text()); });
  };

  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const newKarmaster = await context.newPage(); track(newKarmaster, 'newKarmaster');

    await customer.goto('http://localhost:8000/customer.html');
    await customer.click('text=간편 로그인');
    await customer.click('text=계약내역 등록하기');
    await customer.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customer.fill('#rq-km-phone', '010-9999-8888'); // 등록되지 않은 카마스터 연락처
    await customer.waitForSelector('text=아직 등록되지 않은 카마스터입니다', { timeout: 3000 });
    console.log('1) 고객: 미등록 연락처 입력 시 안내 문구 확인');
    await customer.fill('#rq-car', '카니발 하이브리드');
    await customer.selectOption('#rq-brand', '기타'); // 현대/기아를 고르면 카마스터 실명 마스킹 정책이 발동해 아래 6번 검증(실명 노출 확인)과 충돌한다
    await customer.fill('#rq-contract-no', 'KIA-2026-1001');
    await customer.fill('#rq-date', '2026-08-01');
    await customer.fill('#rq-name', '신규개척');
    await customer.fill('#rq-phone', '01044445555');
    await customer.click('#rq-submit');
    await customer.waitForSelector('#confirm-code-display', { timeout: 3000 });
    const token = (await customer.locator('#confirm-code-display').innerText()).trim();
    const noticeText = await customer.locator('.msg-box').innerText();
    console.log('2) 고객: 계약내역 등록, 조회번호 발급:', token, '/ 안내:', noticeText.slice(0, 40));

    await newKarmaster.goto('http://localhost:8000/karmaster.html');
    await newKarmaster.click('text=비가입자이신가요? 계약 확인하기');
    await newKarmaster.fill('#ul-phone', '010-9999-8888');
    await newKarmaster.fill('#ul-contract-no', 'KIA-2026-1001');
    await newKarmaster.fill('#ul-code', token);
    await newKarmaster.click('#ul-submit');
    await newKarmaster.waitForSelector('text=등록된 계약 내용 (고객 입력)', { timeout: 3000 });
    const reviewText = await newKarmaster.locator('.admin-controls').first().innerText();
    console.log('3) 신규 카마스터: 전화번호+계약번호+조회번호 확인 — 고객이 입력한 차량정보 자동 노출:', reviewText.includes('카니발 하이브리드'));
    await newKarmaster.fill('#ua-name', '정도윤 카마스터');
    await newKarmaster.click('#ua-grp-g_gyeonggi');
    await newKarmaster.click('#ua-dest-AFFILIATED_SHOP');
    await newKarmaster.click('#ua-submit');
    await newKarmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });
    console.log('4) 신규 카마스터: 가입 없이 전화번호+계약번호+조회번호로 본인확인 후 계약 내용 승인');

    // 새로 만들어진 카마스터가 로그인 화면(등록 카마스터 목록)에도 나타나는지 확인
    const loginCheck = await context.newPage(); track(loginCheck, 'loginCheck');
    await loginCheck.goto('http://localhost:8000/karmaster.html');
    const newKarmasterVisible = await loginCheck.locator('#quick-login option', { hasText: '정도윤' }).count();
    console.log('5) 로그인 화면에 신규 카마스터가 정식 등록되어 나타나는지(1이어야 정상):', newKarmasterVisible);

    await customer.waitForSelector('text=계약 내용 확인 →', { timeout: 3000 });
    const contractText = await customer.locator('.msg-box').innerText();
    console.log('6) 고객 화면에 반영된 계약 내용:', contractText.replace(/\n/g, ' / '));

    const pass = noticeText.includes('아직 이 서비스에 등록되지 않은') && reviewText.includes('카니발 하이브리드') && newKarmasterVisible === 1 && contractText.includes('정도윤') && contractText.includes('카니발 하이브리드');
    if (!pass || errors.length) {
      console.log('\n--- 테스트 실패 ---');
      errors.forEach(e => console.log(e));
      process.exitCode = 1;
    } else {
      console.log('\n--- 통과: 미등록 카마스터가 조회번호만으로 가입과 동시에 계약에 자동 연결됨 ---');
    }
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    if (errors.length) { console.log('--- 수집된 페이지 에러 ---'); errors.forEach(x => console.log(x)); }
    process.exitCode = 1;
  }

  await browser.close();
})();
