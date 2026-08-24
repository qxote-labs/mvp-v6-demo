const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (page, tag) => {
    page.on('pageerror', e => errors.push(`[${tag}] PAGEERROR: ` + e.message));
  };

  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const karmaster = await context.newPage(); track(karmaster, 'karmaster');

    await customer.goto('http://localhost:8000/customer.html');
    await customer.click('text=간편 로그인');
    await customer.click('text=계약내역 등록하기');
    await customer.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customer.fill('#rq-km-phone', '01022223301'); // 김도현 카마스터 연락처
    await customer.fill('#rq-car', '아반떼');
    await customer.fill('#rq-date', '2026-08-01');
    await customer.fill('#rq-name', '메시지테스트');
    await customer.fill('#rq-phone', '01099990000');
    await customer.fill('#rq-nick', '문의왕');
    await customer.click('#rq-submit');
    await customer.waitForSelector('#msg-input', { timeout: 3000 });
    console.log('1) 고객: 계약내역 등록 (카마스터 승인 전이지만 메시지 채널은 이미 열려 있음)');

    // 고객 -> 카마스터 메시지 전송 (카마스터가 승인하기 전에도 메시지 채널은 열려 있어야 한다)
    await customer.fill('#msg-input', '상담 시간을 조금 앞당길 수 있을까요?');
    await customer.click('#msg-send');
    await customer.waitForSelector('.msg-bubble.mine');
    console.log('2) 고객: 카마스터에게 메시지 전송');

    await karmaster.goto('http://localhost:8000/karmaster.html');
    await karmaster.selectOption('#quick-login', { index: 1 }); // 김도현 카마스터

    // 카마스터 화면: 목록·상세가 항상 함께 보이는 구조 — 선택 전에는 "신규" 배지가 보여야 하고,
    // (재)선택하면 읽음 처리되어야 함
    await karmaster.waitForSelector('table tr.clickable');
    const unreadBadgeBefore = await karmaster.locator('table tr.clickable').innerText();
    console.log('2-1) 선택 전 목록에 안읽음 표시(🔔 신규) 포함 여부:', unreadBadgeBefore.includes('신규'));
    await karmaster.click('table tr.clickable >> nth=0');
    await karmaster.waitForSelector('text=상담 시간을 조금 앞당길 수 있을까요?', { timeout: 3000 });
    console.log('3) 카마스터: 고객 선택 후 메시지 수신 확인');

    const replyInput = karmaster.locator('input[id^="msg-input-"]').first();
    await replyInput.fill('네, 1시간 당겨서 진행 가능합니다.');
    await karmaster.locator('button[id^="msg-send-"]').first().click();
    console.log('4) 카마스터: 답장 전송');

    await customer.waitForSelector('.msg-bubble.theirs', { timeout: 3000 });
    const threadText = await customer.locator('#msg-thread').innerText();
    console.log('5) 고객 화면 메시지 스레드:\n' + threadText);

    if (!threadText.includes('1시간 당겨서') || !unreadBadgeBefore.includes('신규') || errors.length) {
      console.log('\n--- 메시지 기능 테스트 실패 ---');
      errors.forEach(e => console.log(e));
      process.exitCode = 1;
    } else {
      console.log('\n--- 메시지 기능 테스트 통과: 고객↔카마스터 실시간 메시지 왕복 확인 ---');
    }
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    process.exitCode = 1;
  }

  await browser.close();
})();
