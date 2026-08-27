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
    const shop = await context.newPage(); track(shop, 'shop');
    const driver = await context.newPage(); track(driver, 'driver');

    // 0) 고객: 로그인 후 이미 체결한 계약 내용(차량정보+카마스터 연락처)을 직접 입력해 계약내역 등록
    await customer.goto('http://localhost:8000/customer.html');
    await customer.fill('#login-name', '홍길동');
    await customer.fill('#login-phone', '01011112222'); // "내 차량"(신차 케어 서비스 진입)이 이 로그인 번호로 조회된다
    await customer.click('#login-submit');
    await customer.click('text=계약내역 등록하기');
    await customer.waitForSelector('#rq-km-phone', { timeout: 3000 });
    await customer.fill('#rq-km-phone', '01022223301'); // 김도현 카마스터 연락처 (등록됨)
    await customer.fill('#rq-car', '쏘렌토 하이브리드');
    await customer.selectOption('#rq-brand', '기아');
    await customer.fill('#rq-contract-no', 'KIA-2026-7001');
    await customer.fill('#rq-trim', '시그니처');
    await customer.fill('#rq-color', '스노우 펄');
    await customer.fill('#rq-date', '2026-08-01');
    await customer.fill('#rq-name', '홍길동');
    await customer.fill('#rq-phone', '01011112222');
    await customer.fill('#rq-nick', '차박러99');
    await customer.click('#rq-submit');
    await customer.waitForSelector('text=카마스터 승인 대기', { timeout: 3000 });
    console.log('1) 고객: 계약내역 등록 (등록된 카마스터 — 승인 대기 상태로 바로 전달됨)');

    // 1) 카마스터: 목록에서 요청을 열고, 고객이 등록한 계약 내용을 검토한 뒤 승인 (코드 입력 없음)
    await karmaster.goto('http://localhost:8000/karmaster.html');
    await karmaster.selectOption('#quick-login', { index: 1 }); // 김도현 카마스터
    await karmaster.waitForSelector('table tr.clickable', { timeout: 3000 });
    await karmaster.click('table tr.clickable >> nth=0');
    await karmaster.waitForSelector('text=고객이 등록한 계약 내용', { timeout: 3000 });
    const reviewText = await karmaster.locator('.admin-controls').first().innerText();
    console.log('2) 카마스터 화면에 표시된 검토 내용:', reviewText.split('\n').slice(0, 4).join(' / '));
    await karmaster.click('button[id^="km-dest-AFFILIATED_SHOP-"]');
    await karmaster.fill('textarea[id^="km-memo-"]', '색상 변경 희망');
    await karmaster.click('button[id^="km-fill-submit-"]');
    await karmaster.waitForSelector('text=고객 확인 대기중', { timeout: 3000 });
    console.log('3) 카마스터: 계약 내용 검토 후 승인 (시공 필요)');

    // 2) 고객: 계약 내용 확인
    await customer.waitForSelector('text=계약 내용 확인 →', { timeout: 3000 });
    const contractText = await customer.locator('.msg-box').innerText();
    console.log('3) 고객 화면에 표시된 계약 내용:', contractText.replace(/\n/g, ' / '));
    await customer.click('text=계약 내용 확인 →');
    console.log('4) 고객: 계약 내용 확인 (계약확정)');

    // 2) 고객: 애프터마켓(신차 케어 서비스) 신청 — 신차인도서비스와 완전히 독립된 별개 서비스이므로,
    // 계약확정 화면에서는 그 서비스로 "이동"만 하고(내 차량이 1대뿐이라 차량선택은 자동으로 건너뜀),
    // 실제 신청은 별도 화면(신차 케어 서비스 신청)에서 이뤄진다.
    await customer.waitForSelector('#care-cross-open', { timeout: 3000 });
    await customer.click('#care-cross-open');
    await customer.waitForSelector('.shop-grid', { timeout: 3000 });
    await customer.click('.shop-card >> nth=1');
    await customer.click('#opt-door_ppf');
    await customer.click('.path-tab >> nth=0'); // 온라인 즉시견적
    await customer.fill('#am-request', '도어 하부 PPF 추가 부탁드립니다');
    await customer.click('#am-submit');
    await customer.waitForSelector('text=시공사 견적 대기중', { timeout: 3000 });
    console.log('4) 고객: 애프터마켓 견적 요청 (시공사 온라인 선택, 카마스터 관여 없음)');

    // 카마스터는 신차 케어 서비스와 전혀 무관한 별개 역할이라, 이 시점에 그 진행 상태를 알지도 못한다.
    // 카마스터가 출고를 의뢰하지 못하는 이유는 오직 하나 — 고객이 아직 "차량 출고 요청"을 누르지 않았기 때문이다.
    await karmaster.waitForSelector('text=출고 요청 대기중', { timeout: 3000 });
    const hasReleaseBtnTooEarly = await karmaster.locator('text=공장에 출고 의뢰하기 →').count();
    console.log('5) 카마스터: 고객 출고요청 전 상태에서 출고 요청 버튼 노출 여부(0이어야 정상):', hasReleaseBtnTooEarly);

    // 3) 시공업체: 견적 회신
    await shop.goto('http://localhost:8000/shop.html');
    await shop.waitForSelector('#quick-login');
    await shop.selectOption('#quick-login', { index: 2 }); // 울산 B샵 (nth=1과 동일 순번)
    await shop.waitForSelector('input[id^="quote-price-"]', { timeout: 3000 });
    await shop.click('button[id^="quote-send-"]');
    console.log('6) 시공업체: 견적 회신');

    // 4) 고객: 견적 확인 → 애프터마켓 계약 완료
    await customer.waitForSelector('text=시공사 견적이 도착했습니다', { timeout: 3000 });
    await customer.click('#am-confirm');
    await customer.waitForSelector('text=신차 케어 서비스 계약이 완료되었습니다', { timeout: 3000 });
    console.log('7) 고객: 견적 확인 → 애프터마켓 계약 완료');

    // 4-1) 고객: 신차 케어 서비스는 완전히 별개 화면이라, 견적 확인 후에도 자동으로 신차인도서비스
    // 쪽으로 돌아가지 않는다 — 이력에서 원래 계약을 직접 찾아가야 한다(신차인도서비스와 신차 케어
    // 서비스가 진짜 독립된 서비스임을 보여주는 지점).
    await customer.click('text=신차 케어 서비스 목록으로');
    await customer.waitForSelector('text=← 처음으로', { timeout: 3000 });
    await customer.click('text=← 처음으로');
    await customer.waitForSelector('text=내 계약 확인 / 이력 조회', { timeout: 3000 });
    await customer.click('text=내 계약 확인 / 이력 조회');
    // 로그인 연락처로 자동 조회되므로 별도 검색 없이 바로 목록이 뜬다.
    await customer.waitForSelector('table tr.clickable', { timeout: 3000 });
    await customer.click('table tr.clickable >> nth=0');
    console.log('7-0) 고객: 이력에서 신차인도서비스 계약을 다시 찾아 진입 (신차 케어 서비스와는 별개 화면임을 확인)');

    // 4-2) 고객: 이제서야 차량 출고를 요청할 수 있다 — 계약 확정이 곧바로 출고를 트리거하지 않는다
    await customer.waitForSelector('#rel-addr', { timeout: 3000 });
    await customer.fill('#rel-addr', '울산광역시 남구 자택');
    await customer.click('text=차량 출고 요청하기');
    console.log('7-1) 고객: 차량 출고 요청 (애프터마켓 계약 완료 후에만 버튼이 나타났음을 확인)');

    // 5) 카마스터: 고객의 출고 요청을 받은 뒤에야 공장에 출고를 의뢰할 수 있다
    await karmaster.waitForSelector('text=공장에 출고 의뢰하기 →', { timeout: 3000 });
    await karmaster.click('text=공장에 출고 의뢰하기 →');
    console.log('8) 카마스터: 공장에 출고 의뢰 (애프터마켓 계약 완료 + 고객 출고요청 후에만 가능했음을 확인)');

    // 이 계약은 "출고 후 시공예정(A-경로)"이라 최종 목적지 전에 카마스터 지정업체를 먼저 들른다 —
    // 카마스터-업체 간 별개 거래라 고객 화면에는 이동중 안내만 노출되고 실시간 배송 상세는 없다
    // (신차 케어 서비스와도 무관).
    await customer.waitForSelector('text=지정업체로 이동중', { timeout: 3000 });
    console.log('8-1) 고객: 지정업체행 구간은 실시간 배송 상세 없이 이동중 안내만 노출됨을 확인');

    // 6) 배송기사: 1차 구간(공장 → 지정업체) 배송
    await driver.goto('http://localhost:8000/driver.html');
    await driver.selectOption('#quick-login', { index: 1 }); // 최기사
    await driver.waitForSelector('.dstepper', { timeout: 3000 });
    await driver.click('button[id^="arrive-"]');
    console.log('9) 배송기사: 지정업체 도착 처리 (1차 구간)');

    // 6-1) 카마스터: 지정업체와 소통해 시공완료를 직접 확인 — 고객·신차 케어 서비스와 무관한 별개 거래
    await karmaster.waitForSelector('text=시공완료 확인 →', { timeout: 3000 });
    await karmaster.click('text=시공완료 확인 →');
    console.log('9-1) 카마스터: 지정업체 시공완료 확인 → 최종 목적지로 재배송 시작');

    // 6-2) 배송기사: 2차 구간(지정업체 → 최종 목적지) 배송
    await customer.waitForSelector('.dstepper', { timeout: 3000 });
    await driver.waitForSelector('.dstepper', { timeout: 3000 });
    await driver.click('button[id^="arrive-"]');
    console.log('9-2) 배송기사: 최종 목적지 도착 처리 (2차 구간)');

    // 6-3) 카마스터: 개인수령확인 (DELIVERED → CONFIRMED 전환 조건 중 카마스터 측)
    await karmaster.waitForSelector('text=개인수령확인 처리', { timeout: 3000 });
    await karmaster.click('text=개인수령확인 처리');
    console.log('9-3) 카마스터: 개인수령확인 처리');

    // 7) 고객: 도착 확인(검수+전자서명) — 카마스터 개인수령확인과 함께 이 시점에 신차인도서비스 역할이 끝난다
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
    console.log('10) 고객: 검수(이상없음)+전자서명 후 인수 확인 → 카마스터 역할 종료');

    await karmaster.waitForSelector('text=신차인도서비스 완료', { timeout: 3000 });
    const kmMonitorSectionCount = await karmaster.locator('#section-journey .tl-wrap').count();
    console.log('11) 카마스터 화면에 시공 모니터링(타임라인) 섹션이 없어야 함(0이어야 정상):', kmMonitorSectionCount);

    // 8) 시공업체: 차량이 신차인도서비스 배송에 얹혀 왔는지 여부와 무관하게, 스스로 입고를 확인해야
    // 시공 흐름이 시작된다 (신차 케어 서비스가 배송 도착을 자동으로 감지하지 않는 지점).
    await shop.waitForSelector('button[id^="dropoff-"]', { timeout: 3000 });
    await shop.click('button[id^="dropoff-"]');
    console.log('11-1) 시공업체: 입고 확인 (신차 케어 서비스는 도착을 자동 감지하지 않고 시공사가 직접 확인)');

    await shop.waitForSelector('.status-flow', { timeout: 3000 });
    await shop.click('.status-flow button:has-text("작업중")');
    await shop.waitForSelector('button[id^="photo-sample-"]');
    await shop.click('button[id^="photo-sample-"]');
    await shop.click('.status-flow button:has-text("작업완료")');
    await shop.waitForSelector('button[id^="request-inspect-"]', { timeout: 3000 });
    await shop.click('button[id^="request-inspect-"]');
    console.log('12) 시공업체: 입고→작업→작업완료→고객 검수 요청');

    // 9) 고객: 신차 케어 서비스 진행상황은 신차인도서비스 화면에 자동으로 뜨지 않는다 — 다시 그
    // 서비스로 직접 이동해야 검수 화면을 볼 수 있다(완전히 독립된 서비스임을 다시 한번 보여주는 지점).
    await customer.waitForSelector('text=내 계약 확인으로', { timeout: 3000 });
    await customer.click('text=내 계약 확인으로');
    await customer.waitForSelector('text=← 처음으로', { timeout: 3000 });
    await customer.click('text=← 처음으로');
    await customer.waitForSelector('button:has-text("신차 케어 서비스")', { timeout: 3000 });
    await customer.click('button:has-text("신차 케어 서비스")');
    await customer.waitForSelector('table tr.clickable', { timeout: 3000 });
    await customer.click('table tr.clickable >> nth=0');
    console.log('12-1) 고객: 신차 케어 서비스로 다시 이동해 검수 화면 확인');

    // 10) 고객: 검수(오너 단독, 카마스터 확인 불필요) → 출차
    await customer.waitForSelector('text=만족합니다, 출차 승인', { timeout: 3000 });
    await customer.click('text=만족합니다, 출차 승인');
    console.log('13) 고객: 검수 확인, 출차 승인 (오너 단독)');

    await shop.waitForSelector('button[id^="second-leg-"]', { timeout: 3000 });
    await shop.click('button[id^="second-leg-"]');
    console.log('14) 시공업체: 2차 배송 시작');

    // 10) 배송기사: 오너에게 재배송
    await driver.waitForSelector('.dstepper', { timeout: 3000 });
    await driver.click('button[id^="arrive-"]');
    console.log('15) 배송기사: 오너에게 도착 처리');

    // 11) 고객: 최종 수령 확인 (오너 단독)
    await customer.waitForSelector('text=차량 수령 확인하기', { timeout: 3000 });
    await customer.click('text=차량 수령 확인하기');
    console.log('16) 고객: 최종 수령 확인');

    // 12) 고객: 정찰제 확인 → 시공사 평가 (독립 포인트 적립)
    await customer.waitForSelector('.check-q', { timeout: 3000 });
    await customer.click('text=아니오, 견적가 그대로였습니다');
    await customer.waitForSelector('text=시공사 평가하고 포인트 받기', { timeout: 3000 });
    await customer.click('text=시공사 평가하고 포인트 받기');
    await customer.waitForSelector('#rating-submit', { timeout: 3000 });
    await customer.click('#rating-submit');
    console.log('17) 고객: 정찰제 확인 → 시공사 평가 제출 (애프터마켓 포인트 적립)');

    // 13) 고객: 카마스터 평가 (신차인도서비스 쪽 독립 포인트) — 시공사 평가 제출 후에는 신차 케어
    // 서비스 목록으로 돌아가므로, 신차인도서비스 이력으로 다시 직접 이동해야 한다.
    await customer.waitForSelector('text=← 처음으로', { timeout: 3000 });
    await customer.click('text=← 처음으로');
    await customer.waitForSelector('text=내 계약 확인 / 이력 조회', { timeout: 3000 });
    await customer.click('text=내 계약 확인 / 이력 조회');
    // 로그인 연락처로 자동 조회되므로 별도 검색 없이 바로 목록이 뜬다.
    await customer.waitForSelector('table tr.clickable', { timeout: 3000 });
    await customer.click('table tr.clickable >> nth=0');
    await customer.waitForSelector('text=카마스터 평가하고 포인트 받기', { timeout: 3000 });
    await customer.click('text=평가하고 포인트 받기');
    await customer.waitForSelector('#rating-submit', { timeout: 3000 });
    await customer.click('#rating-submit');
    console.log('18) 고객: 카마스터 평가 제출 (신차인도서비스 포인트 적립)');

    // 19) 고객: 신차 케어 서비스 쪽 완료 화면도 완전히 별개 경로로 확인 (신차인도서비스 이력이 아니라
    // "신차 케어 서비스" 목록에서 별도로 조회해야 함 — 두 서비스가 진짜 독립임을 보여주는 지점)
    await customer.waitForSelector('text=← 처음으로', { timeout: 3000 });
    await customer.click('text=← 처음으로');
    await customer.waitForSelector('button:has-text("신차 케어 서비스")', { timeout: 3000 });
    await customer.click('button:has-text("신차 케어 서비스")');
    await customer.waitForSelector('table tr.clickable', { timeout: 3000 });
    await customer.click('table tr.clickable >> nth=0');
    await customer.waitForSelector('text=신차 케어 서비스가 완료되었습니다', { timeout: 3000 });
    const finalBadge = await customer.locator('.badge.done').first().innerText();
    console.log('19) 최종 화면 확인 (신차 케어 서비스 완료, 신차인도서비스와 별개):', finalBadge);

    const pass = hasReleaseBtnTooEarly === 0 && kmMonitorSectionCount === 0;
    if (!pass || errors.length) {
      console.log('\n--- 테스트 실패 ---');
      errors.forEach(e => console.log(e));
      process.exitCode = 1;
    } else {
      console.log('\n--- JS 에러 없음, 전체 시나리오(신차인도서비스 + 애프터마켓 독립 흐름) 통과 ---');
    }
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    if (errors.length) { console.log('--- 수집된 페이지 에러 ---'); errors.forEach(x => console.log(x)); }
    process.exitCode = 1;
  }

  await browser.close();
})();
