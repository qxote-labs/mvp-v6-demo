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
    const karmaster = await context.newPage(); track(karmaster, 'karmaster');
    const driver = await context.newPage(); track(driver, 'driver');

    await customer.goto('http://localhost:8000/customer.html');
    await customer.click('text=간편 로그인');
    await customer.click('text=계약내역 등록하기');
    await customer.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customer.fill('#rq-km-phone', '01022223302'); // 박서연 카마스터 연락처
    await customer.fill('#rq-car', '아이오닉5');
    await customer.fill('#rq-date', '2026-08-01');
    await customer.fill('#rq-name', '김영희');
    await customer.fill('#rq-phone', '01033334444');
    await customer.fill('#rq-nick', '무시공러');
    await customer.click('#rq-submit');
    await customer.waitForSelector('text=카마스터 승인 대기', { timeout: 3000 });
    console.log('1) 고객: 계약내역 등록');

    await karmaster.goto('http://localhost:8000/karmaster.html');
    await karmaster.selectOption('#quick-login', { index: 2 }); // 박서연
    await karmaster.waitForSelector('table tr.clickable', { timeout: 3000 });
    await karmaster.click('table tr.clickable >> nth=0');
    await karmaster.waitForSelector('text=고객이 등록한 계약 내용', { timeout: 3000 });
    await karmaster.click('button[id^="km-need-n-"]'); // 시공 불필요
    await karmaster.click('button[id^="km-fill-submit-"]');
    await karmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });
    console.log('2) 카마스터: 계약 내용 검토 후 승인 (시공 불필요로 합의)');

    await customer.waitForSelector('text=계약 내용 확인 →', { timeout: 3000 });
    await customer.click('text=계약 내용 확인 →');
    await customer.waitForSelector('text=시공 없이 순수 차량 구매', { timeout: 3000 });
    console.log('3) 고객: 계약 확인 (시공 없음 안내 확인, 애프터마켓 단계 없이 바로 출고 대기)');

    await customer.waitForSelector('#rel-addr', { timeout: 3000 });
    await customer.fill('#rel-addr', '울산광역시 남구 자택');
    await customer.click('text=차량 출고 요청하기');
    console.log('3-1) 고객: 차량 출고 요청 (계약 확정이 곧바로 출고를 트리거하지 않음을 확인)');

    await karmaster.waitForSelector('text=공장에 출고 의뢰하기 →', { timeout: 3000 });
    await karmaster.click('text=공장에 출고 의뢰하기 →');
    console.log('4) 카마스터: 공장에 출고 의뢰 (애프터마켓 계약 없이도 고객 출고요청만 있으면 가능)');

    await customer.waitForSelector('.dstepper', { timeout: 3000 });

    await driver.goto('http://localhost:8000/driver.html');
    await driver.selectOption('#quick-login', { index: 1 }); // 최기사
    await driver.waitForSelector('.dstepper', { timeout: 3000 });
    await driver.click('button[id^="arrive-"]');
    console.log('4) 배송기사: 즉시 도착 처리 (오너에게 직행 — 시공업체 경유 없음)');

    await customer.waitForSelector('text=차량 수령 확인하기', { timeout: 3000 });
    await customer.click('text=차량 수령 확인하기');
    console.log('5) 고객: 수령 확인 (오너 단독, 카마스터 확인 불필요)');

    await customer.waitForSelector('text=신차인도서비스가 완료되었습니다', { timeout: 3000 });
    console.log('6) 고객: 완료 화면 도달 (정찰제 확인 없이 바로 완료 — 정찰제는 애프터마켓 전용 개념)');

    await customer.click('text=카마스터 평가하고 포인트 받기');
    await customer.click('#rating-submit');
    await customer.waitForSelector('#hist-phone', { timeout: 3000 });
    await customer.fill('#hist-phone', '01033334444');
    await customer.click('#hist-search');
    await customer.waitForSelector('table tr.clickable', { timeout: 3000 });
    await customer.click('table tr.clickable >> nth=0');
    await customer.waitForSelector('text=카마스터 평가 완료', { timeout: 3000 });
    console.log('7) 고객: 카마스터 평가 제출 → 포인트 적립 확인');

    if (errors.length) { console.log('\n--- JS 에러 발견 ---'); errors.forEach(e => console.log(e)); process.exitCode = 1; }
    else console.log('\n--- JS 에러 없음, 전체 시나리오(시공 불필요 경로) 통과 ---');
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    if (errors.length) { console.log('--- 수집된 페이지 에러 ---'); errors.forEach(x => console.log(x)); }
    process.exitCode = 1;
  }

  await browser.close();
})();
