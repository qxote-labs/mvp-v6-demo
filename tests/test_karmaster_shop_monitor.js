// v6에서는 카마스터가 더 이상 시공 진행 상황을 모니터링하지 않는다 — 차량이 목적지에 도착해
// 오너가 확인하는 순간 신차인도서비스에서의 카마스터 역할이 끝나기 때문이다. 다만 "온라인 영업행위
// 금지"가 "고객 응대 차원의 정보교류 금지"를 뜻하는 것은 아니므로, 메시지 채널만은 역할 종료 후에도
// 계속 열려 있어야 한다. 이 테스트는 그 경계(모니터링 없음 + 메시지는 유지)를 검증한다.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (page, tag) => { page.on('pageerror', e => errors.push(`[${tag}] PAGEERROR: ` + e.message)); };

  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const karmaster = await context.newPage(); track(karmaster, 'karmaster');
    const driver = await context.newPage(); track(driver, 'driver');

    await customer.goto('http://localhost:8000/customer.html');
    await customer.click('text=간편 로그인');
    await customer.click('text=계약내역 등록하기');
    await customer.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customer.fill('#rq-km-phone', '01022223301'); // 김도현 카마스터 연락처
    await customer.fill('#rq-car', '스포티지');
    await customer.selectOption('#rq-brand', '기아');
    await customer.fill('#rq-contract-no', 'KIA-2026-5001');
    await customer.fill('#rq-date', '2026-08-01');
    await customer.fill('#rq-name', '모니터고객');
    await customer.fill('#rq-phone', '01099998888');
    await customer.fill('#rq-nick', '지켜보는중');
    await customer.click('#rq-submit');
    await customer.waitForSelector('text=카마스터 승인 대기', { timeout: 3000 });
    console.log('0) 고객: 계약내역 등록');

    await karmaster.goto('http://localhost:8000/karmaster.html');
    await karmaster.selectOption('#quick-login', { index: 1 }); // 김도현 카마스터
    await karmaster.waitForSelector('table tr.clickable', { timeout: 3000 });
    await karmaster.click('table tr.clickable >> nth=0');
    await karmaster.waitForSelector('text=고객이 등록한 계약 내용', { timeout: 3000 });
    await karmaster.click('button[id^="km-dest-DEALERSHIP-"]'); // 애프터마켓 없이 순수 인도만
    await karmaster.click('button[id^="km-fill-submit-"]');
    await karmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });

    await customer.waitForSelector('text=계약 내용 확인 →', { timeout: 3000 });
    await customer.click('text=계약 내용 확인 →');
    console.log('1) 고객: 계약 확인');

    await customer.waitForSelector('#rel-addr', { timeout: 3000 });
    await customer.fill('#rel-addr', '울산광역시 남구 자택');
    await customer.click('text=차량 출고 요청하기');

    await karmaster.waitForSelector('text=공장에 출고 의뢰하기 →', { timeout: 3000 });
    await karmaster.click('text=공장에 출고 의뢰하기 →');
    await customer.waitForSelector('.dstepper', { timeout: 3000 });

    await driver.goto('http://localhost:8000/driver.html');
    await driver.selectOption('#quick-login', { index: 1 }); // 최기사
    await driver.waitForSelector('.dstepper', { timeout: 3000 });
    await driver.click('button[id^="arrive-"]');

    await karmaster.waitForSelector('text=개인수령확인 처리', { timeout: 3000 });
    await karmaster.click('text=개인수령확인 처리');
    console.log('1-1) 카마스터: 개인수령확인 처리 (DELIVERED → CONFIRMED 전환 조건 중 카마스터 측)');

    await customer.waitForSelector('#insp-ok', { timeout: 3000 });
    await customer.click('#insp-ok');
    const sigBox1 = await customer.locator('#insp-sig').boundingBox();
    await customer.mouse.move(sigBox1.x + 20, sigBox1.y + 20);
    await customer.mouse.down();
    await customer.mouse.move(sigBox1.x + 100, sigBox1.y + 60);
    await customer.mouse.move(sigBox1.x + 180, sigBox1.y + 30);
    await customer.mouse.up();
    await customer.waitForSelector('#insp-submit:not([disabled])', { timeout: 3000 });
    await customer.click('#insp-submit');
    console.log('2) 고객: 검수(이상없음)+전자서명 후 인수 확인 → 신차인도서비스 완료, 카마스터 역할 종료');

    await karmaster.waitForSelector('text=신차인도서비스 완료', { timeout: 3000 });
    const journeyText = await karmaster.locator('#section-journey').innerText();
    const hasMonitoring = journeyText.includes('시공 진행');
    console.log('3) 카마스터 화면에 시공 모니터링 문구가 없어야 함(false여야 정상):', hasMonitoring);

    // 역할이 끝났어도 메시지 채널은 계속 열려 있어야 한다
    await customer.fill('#msg-input', '차량 잘 받았습니다, 감사합니다!');
    await customer.click('#msg-send');
    await customer.waitForSelector('.msg-bubble.mine');
    console.log('4) 고객: 인도 완료 후에도 카마스터에게 메시지 전송 가능');

    await karmaster.waitForSelector('text=차량 잘 받았습니다', { timeout: 3000 });
    console.log('5) 카마스터: 역할 종료 후에도 메시지 수신 확인 (응대 채널은 유지됨)');

    if (hasMonitoring || errors.length) {
      console.log('\n--- 테스트 실패 ---');
      errors.forEach(e => console.log(e));
      process.exitCode = 1;
    } else {
      console.log('\n--- 통과: 카마스터 역할은 인도완료 시점에 끝나되(모니터링 없음), 메시지 응대 채널은 유지됨 ---');
    }
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    process.exitCode = 1;
  }

  await browser.close();
})();
