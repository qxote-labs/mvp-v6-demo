// v6.2에서는 차량정보(모델·트림·색상·계약일자)를 고객이 계약내역등록 시점에 직접 입력한다 — 카마스터는
// 그 값을 검토·승인할 뿐 다시 입력하지 않는다. 이 테스트는 (1) 고객이 입력한 차량정보가 카마스터의
// 검토 화면에 그대로 반영되는지, (2) 카마스터가 승인 시점에 남긴 상담 메모가 고객 화면에 반영되는지를
// 검증한다 — 정보가 양방향으로 정확히 전달되는지 확인하는 것이 핵심이다.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (page, tag) => { page.on('pageerror', e => errors.push(`[${tag}] PAGEERROR: ` + e.message)); };

  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const karmaster = await context.newPage(); track(karmaster, 'karmaster');

    await customer.goto('http://localhost:8000/customer.html');
    await customer.fill('#login-name', '이관심');
    await customer.fill('#login-phone', '01077778888');
    await customer.click('#login-submit');
    await customer.click('text=신차인도서비스');
    await customer.click('text=계약내역 등록하기');
    await customer.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customer.fill('#rq-km-phone', '01022223301'); // 김도현 카마스터 연락처
    await customer.fill('#rq-car', '팰리세이드');
    await customer.selectOption('#rq-brand', '현대');
    await customer.fill('#rq-contract-no', 'HD-2026-4001');
    await customer.fill('#rq-trim', '캘리그래피');
    await customer.fill('#rq-color', '어비스 블랙');
    await customer.fill('#rq-date', '2026-08-01');
    await customer.fill('#rq-name', '이관심');
    await customer.fill('#rq-phone', '01077778888');
    await customer.fill('#rq-nick', '차종고민중');
    await customer.click('#rq-submit');
    await customer.waitForSelector('text=카마스터 승인 대기', { timeout: 3000 });
    console.log('1) 고객: 차량정보(팰리세이드·캘리그래피·어비스 블랙) 포함해 계약내역 등록');

    await karmaster.goto('http://localhost:8000/karmaster.html');
    await karmaster.selectOption('#quick-login', { index: 1 }); // 김도현 카마스터
    await karmaster.waitForSelector('table tr.clickable', { timeout: 3000 });
    await karmaster.click('table tr.clickable >> nth=0');
    await karmaster.waitForSelector('text=고객이 등록한 계약 내용', { timeout: 3000 });
    const reviewText = await karmaster.locator('.admin-controls').first().innerText();
    console.log('2) 카마스터 검토 화면에 표시된 내용:\n' + reviewText);

    await karmaster.click('button[id^="km-dest-AFFILIATED_SHOP-"]');
    await karmaster.fill('textarea[id^="km-memo-"]', '패밀리카로 고민중이라 3열 공간 위주로 상담함');
    await karmaster.click('button[id^="km-fill-submit-"]');
    await karmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });
    console.log('3) 카마스터: 차량정보 검토 후 승인, 상담 메모 기록');

    await customer.waitForSelector('text=계약 내용 확인 →', { timeout: 3000 });
    const contractText = await customer.locator('.msg-box').innerText();
    console.log('4) 고객 화면에 표시된 계약 내용:\n' + contractText);

    const reviewOk = reviewText.includes('팰리세이드') && reviewText.includes('캘리그래피') && reviewText.includes('어비스 블랙');
    const customerOk = contractText.includes('팰리세이드') && contractText.includes('3열 공간');
    if (!reviewOk || !customerOk) {
      console.log('\n--- 검증 실패: 차량정보 또는 상담메모가 양방향으로 정확히 전달되지 않음 ---');
      process.exitCode = 1;
    } else if (errors.length) {
      console.log('\n--- JS 에러 발견 ---'); errors.forEach(e => console.log(e)); process.exitCode = 1;
    } else {
      console.log('\n--- 통과: 고객이 입력한 차량정보가 카마스터 검토화면에, 카마스터의 상담메모가 고객화면에 정확히 반영됨 ---');
    }
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    process.exitCode = 1;
  }

  await browser.close();
})();
