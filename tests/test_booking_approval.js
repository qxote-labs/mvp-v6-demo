// v6.2에서는 온라인 예약/승인 절차가 없고, 계약은 반드시 고객이 시작한다 — 고객이 이미 체결한 계약의
// 차량정보를 직접 입력해 계약내역을 등록하면, 등록된 카마스터의 대시보드에 바로 뜬다. 이 테스트는 같은
// 카마스터가 여러 고객을 동시에 담당할 때도 각 건이 서로 뒤섞이지 않고 독립적으로 동작하는지, 그리고
// 한 건을 승인해도 다른 건의 대기 상태에 영향을 주지 않는지 검증한다.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (page, tag) => { page.on('pageerror', e => errors.push(`[${tag}] PAGEERROR: ` + e.message)); };

  try {
    const karmaster = await context.newPage(); track(karmaster, 'karmaster');
    const customerA = await context.newPage(); track(customerA, 'customerA');
    const customerB = await context.newPage(); track(customerB, 'customerB');

    // 고객 A: 계약내역 등록
    await customerA.goto('http://localhost:8000/customer.html');
    await customerA.click('text=간편 로그인');
    await customerA.click('text=계약내역 등록하기');
    await customerA.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customerA.fill('#rq-km-phone', '01022223301'); // 김도현 카마스터 연락처
    await customerA.fill('#rq-car', '쏘나타');
    await customerA.selectOption('#rq-brand', '현대');
    await customerA.fill('#rq-contract-no', 'HD-2026-6001');
    await customerA.fill('#rq-date', '2026-08-01');
    await customerA.fill('#rq-name', '고객A');
    await customerA.fill('#rq-phone', '01011110000');
    await customerA.fill('#rq-nick', 'A유저');
    await customerA.click('#rq-submit');
    await customerA.waitForSelector('text=카마스터 승인 대기', { timeout: 3000 });
    console.log('1) 고객A: 계약내역 등록 (쏘나타)');

    // 고객 B: 같은 카마스터에게 계약내역 등록 (다른 차종)
    await customerB.goto('http://localhost:8000/customer.html');
    await customerB.click('text=간편 로그인');
    await customerB.click('text=계약내역 등록하기');
    await customerB.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customerB.fill('#rq-km-phone', '01022223301'); // 김도현 카마스터 연락처
    await customerB.fill('#rq-car', 'K5');
    await customerB.selectOption('#rq-brand', '기아');
    await customerB.fill('#rq-contract-no', 'KIA-2026-6002');
    await customerB.fill('#rq-date', '2026-08-02');
    await customerB.fill('#rq-name', '고객B');
    await customerB.fill('#rq-phone', '01022220000');
    await customerB.fill('#rq-nick', 'B유저');
    await customerB.click('#rq-submit');
    await customerB.waitForSelector('text=카마스터 승인 대기', { timeout: 3000 });
    console.log('2) 고객B: 같은 카마스터에게 계약내역 등록 (K5, 같은 카마스터가 2건 동시 담당)');

    await karmaster.goto('http://localhost:8000/karmaster.html');
    await karmaster.selectOption('#quick-login', { index: 1 }); // 김도현 카마스터
    await karmaster.waitForSelector('table tr.clickable', { timeout: 3000 });
    const rows = karmaster.locator('table tr.clickable');
    const countBefore = await rows.count();
    // 시드 데이터(김민준, k1=김도현 카마스터 담당)가 항상 1건 깔려 있어, 이 테스트가 새로 등록한
    // 고객A+고객B 2건을 더하면 3건이 정상이다.
    console.log('3) 카마스터: 담당 고객 목록 건수 확인 (시드 1건 + 신규 2건 = 3건이어야 함):', countBefore);

    // 카마스터: 고객A 행을 열어 내용 확인 후 승인
    await karmaster.locator('table tr.clickable', { hasText: '고객A' }).click();
    await karmaster.waitForSelector('text=고객이 등록한 계약 내용', { timeout: 3000 });
    const reviewA = await karmaster.locator('.admin-controls').first().innerText();
    console.log('4) 카마스터가 고객A 건에서 본 차량정보(쏘나타여야 함):', reviewA.includes('쏘나타'));
    await karmaster.click('button[id^="km-dest-DEALERSHIP-"]');
    await karmaster.click('button[id^="km-fill-submit-"]');
    await karmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });
    console.log('5) 카마스터: 고객A 건 승인');

    // 고객 A: 계약 확인
    await customerA.waitForSelector('text=계약 내용 확인 →', { timeout: 3000 });
    await customerA.click('text=계약 내용 확인 →');
    await customerA.waitForSelector('text=계약이 확정되었습니다', { timeout: 3000 });
    console.log('6) 고객A: 계약 확인 완료');

    // 고객 B는 카마스터가 아직 승인하지 않았으므로 "고객요청" 상태 그대로여야 한다 (A 승인이 B에 영향 없음)
    await customerB.click('text=내 계약 확인으로');
    await customerB.fill('#hist-phone', '01022220000');
    await customerB.click('#hist-search');
    const stillWaitingBadge = await customerB.locator('table tr.clickable >> nth=0').innerText();
    console.log('7) 고객B는 아직 승인 전 상태 유지 여부(고객요청이어야 함):', stillWaitingBadge.includes('고객요청'));

    // 카마스터: 고객B 행을 열어 내용 확인(A와 섞이지 않고 K5로 정확히 표시되는지) 후 승인
    await karmaster.locator('table tr.clickable', { hasText: '고객B' }).click();
    await karmaster.waitForSelector('text=고객이 등록한 계약 내용', { timeout: 3000 });
    const reviewB = await karmaster.locator('.admin-controls').first().innerText();
    console.log('8) 카마스터가 고객B 건에서 본 차량정보(K5여야 하고 쏘나타가 섞이면 안 됨):', reviewB.includes('K5') && !reviewB.includes('쏘나타'));
    await karmaster.click('button[id^="km-dest-DEALERSHIP-"]');
    await karmaster.click('button[id^="km-fill-submit-"]');
    await karmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });
    console.log('9) 카마스터: 고객B 건 승인');

    await karmaster.waitForTimeout(300);
    const kmListText = await karmaster.locator('table').innerText();
    console.log('10) 카마스터 목록 상태:\n' + kmListText);

    // 고객A는 계약을 확인했을 뿐 아직 "차량 출고 요청하기"를 누르지 않았으므로, 카마스터 목록에는
    // "출고 요청 가능"이 아니라 "고객 출고요청 대기"로 표시되어야 한다(계약 확정이 곧바로 출고
    // 요청 가능 상태로 이어지지 않는다).
    const pass = countBefore === 3 && stillWaitingBadge.includes('고객요청')
      && reviewA.includes('쏘나타') && reviewB.includes('K5') && !reviewB.includes('쏘나타')
      && kmListText.includes('고객 확인 대기') && kmListText.includes('고객 출고요청 대기');
    if (!pass || errors.length) {
      console.log('\n--- 테스트 실패 ---');
      errors.forEach(e => console.log(e));
      process.exitCode = 1;
    } else {
      console.log('\n--- 통과: 계약내역등록→승인→고객확인 흐름이 여러 고객 건에서도 서로 독립적으로 정상 동작 ---');
    }
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    process.exitCode = 1;
  }

  await browser.close();
})();
