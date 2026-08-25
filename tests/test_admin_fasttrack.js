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
    const admin = await context.newPage(); track(admin, 'admin');

    await admin.goto('http://localhost:8000/supervisor.html');
    await admin.waitForSelector('#quick-login', { timeout: 3000 });
    await admin.selectOption('#quick-login', 'admin_super'); // 슈퍼바이저로 로그인 (전체 권한, 그룹 스코프 제한 없음)

    // ===== 1부: 신차인도서비스 — 등록부터 인도완료·평가까지 전 과정을 관리자 단독으로 대리 처리 =====
    await admin.click('text=+ 계약 대리 등록');
    await admin.click('.km-card >> nth=2'); // 담당 카마스터 선택
    await admin.fill('#a-nc-name', '박관리');
    await admin.fill('#a-nc-phone', '01055556666');
    await admin.fill('#a-nc-car', '테슬라 모델Y');
    await admin.selectOption('#a-nc-brand', '기타');
    await admin.fill('#a-nc-contract-no', 'HD-2026-9001');
    await admin.click('#a-nc-dest-AFFILIATED_SHOP');
    await admin.click('#a-nc-submit');
    console.log('1) 관리자: 계약 대리 등록 (제휴 시공소 경유)');

    await admin.waitForSelector('text=고객 확인 대리 처리 →', { timeout: 3000 });
    await admin.click('text=고객 확인 대리 처리 →');
    console.log('2) 관리자: 고객 확인 대리 처리');

    // 계약이 확정됐다고 곧바로 출고가 시작되지 않는다 — 고객 출고요청부터 대리 처리해야 한다.
    await admin.waitForSelector('text=고객 출고 요청 대리 처리', { timeout: 3000 });
    await admin.click('text=고객 출고 요청 대리 처리');
    console.log('3) 관리자: 고객 출고 요청 대리 처리 (계약 확정이 곧바로 출고를 트리거하지 않음)');

    await admin.waitForSelector('text=출고 요청 대리 처리 →', { timeout: 3000 });
    await admin.click('text=출고 요청 대리 처리 →');
    console.log('4) 관리자: 출고 요청 대리 처리 (고객 출고요청 후에만 가능했음을 확인)');

    // 시공 필요(A-경로) 건이라 최종 목적지 전에 카마스터 지정업체를 먼저 들른다 — 이건 카마스터-업체
    // 간 별개 거래라 별도의 "시공완료 확인" 대리처리가 한 번 더 필요하다.
    await admin.waitForSelector('text=즉시 도착 처리', { timeout: 3000 });
    await admin.click('text=즉시 도착 처리');
    console.log('5) 관리자: 배송 즉시 도착 처리 (1차 구간 — 지정업체)');

    await admin.waitForSelector('text=시공완료 확인 대리 처리 →', { timeout: 3000 });
    await admin.click('text=시공완료 확인 대리 처리 →');
    console.log('5-1) 관리자: 지정업체 시공완료 확인 대리 처리 → 최종 목적지로 재배송 시작');

    await admin.waitForSelector('text=즉시 도착 처리', { timeout: 3000 });
    await admin.click('text=즉시 도착 처리');
    console.log('5-2) 관리자: 배송 즉시 도착 처리 (2차 구간 — 최종 목적지)');

    await admin.waitForSelector('text=개인수령확인+수령 확인 대리 처리 (양쪽 모두)', { timeout: 3000 });
    await admin.click('text=개인수령확인+수령 확인 대리 처리 (양쪽 모두)');
    console.log('6) 관리자: 개인수령확인+수령 확인 대리 처리 → 카마스터 역할 종료, 신차인도서비스 완료');

    await admin.waitForSelector('text=카마스터 평가 대리 제출', { timeout: 3000 });
    await admin.click('text=카마스터 평가 대리 제출');
    console.log('7) 관리자: 카마스터 평가 대리 제출 (신차인도서비스 포인트 적립)');

    await admin.waitForSelector('text=이 건은 완료되었습니다', { timeout: 3000 });
    console.log('8) 관리자: 신차인도서비스 전 과정(등록→승인→출고요청→출고의뢰→도착→인도→평가)을 대리 완료');

    // ===== 2부: 신차 케어 서비스 — 신차인도서비스와 완전히 독립된 별도 탭에서, 방금 등록한 "내 차량"을
    // 골라 처음부터 끝까지 관리자가 대리 처리한다. 두 서비스가 실제로 독립된 최상위 목록임을 검증한다. =====
    await admin.click('[onclick="setAdminTab(\'care\')"]');
    await admin.waitForSelector('text=신차 케어 서비스 대리 신청', { timeout: 3000 });
    await admin.click('text=신차 케어 서비스 대리 신청');
    console.log('9) 관리자: 신차 케어 서비스 탭으로 전환 + 대리 신청 폼 진입');

    await admin.waitForSelector('.km-card', { timeout: 3000 });
    await admin.click('.km-card >> nth=0'); // 방금 등록한 "내 차량"(테슬라 모델Y) 선택
    await admin.click('#a-care-submit');
    console.log('10) 관리자: 대상 차량 선택 후 신차 케어 서비스 대리 신청 (시공사 자동 배정)');

    await admin.waitForSelector('text=견적 대리 회신', { timeout: 3000 });
    await admin.click('text=견적 대리 회신');
    console.log('11) 관리자: 시공사 견적 대리 회신');

    await admin.waitForSelector('text=고객 견적 확인 대리 처리', { timeout: 3000 });
    await admin.click('text=고객 견적 확인 대리 처리');
    console.log('12) 관리자: 고객 견적 확인 대리 처리 → 신차 케어 서비스 계약 완료');

    await admin.waitForSelector('text=입고 대리 확인', { timeout: 3000 });
    await admin.click('text=입고 대리 확인');
    console.log('13) 관리자: 입고 대리 확인 (신차 케어 서비스는 도착을 자동 감지하지 않음)');

    await admin.waitForSelector('.status-flow', { timeout: 3000 });
    await admin.click('.status-flow button:has-text("작업중")');
    await admin.click('.status-flow button:has-text("작업완료")');
    await admin.waitForSelector('text=청구액 = 견적가로 대리 입력', { timeout: 3000 });
    await admin.click('text=청구액 = 견적가로 대리 입력');
    await admin.waitForSelector('text=고객 검수 요청 대리 발송', { timeout: 3000 });
    await admin.click('text=고객 검수 요청 대리 발송');
    console.log('14) 관리자: 시공 진행 + 고객 검수 요청 대리 발송');

    await admin.waitForSelector('text=오너 검수 대리 확인', { timeout: 3000 });
    await admin.click('text=오너 검수 대리 확인');
    console.log('15) 관리자: 고객 검수(출차 승인) 대리 처리 — 오너 단독');

    await admin.waitForSelector('text=2차 배송(오너) 대리 시작', { timeout: 3000 });
    await admin.click('text=2차 배송(오너) 대리 시작');
    console.log('16) 관리자: 2차 배송 대리 시작');

    await admin.waitForSelector('text=즉시 도착 처리', { timeout: 3000 });
    await admin.click('text=즉시 도착 처리');
    console.log('17) 관리자: 2차 배송 즉시 도착 처리');

    await admin.waitForSelector('text=오너 수령 대리 확인', { timeout: 3000 });
    await admin.click('text=오너 수령 대리 확인');
    console.log('18) 관리자: 최종 수령 대리 확인 (오너 단독)');

    await admin.waitForSelector('text=정찰제 일치 대리 확인', { timeout: 3000 });
    await admin.click('text=정찰제 일치 대리 확인');
    console.log('19) 관리자: 정찰제 일치 대리 확인');

    await admin.waitForSelector('text=시공사 평가 대리 제출', { timeout: 3000 });
    await admin.click('text=시공사 평가 대리 제출');
    console.log('20) 관리자: 시공사 평가 대리 제출 (신차 케어 서비스 포인트 자동 적립)');

    await admin.waitForSelector('text=정찰제 확인·평가·포인트 적립까지 완료된 건입니다', { timeout: 3000 });
    console.log('21) 관리자: 신차인도서비스·신차 케어 서비스 두 독립 서비스 모두 대리로 완료 처리 가능함을 확인');

    if (errors.length) { console.log('\n--- JS 에러 발견 ---'); errors.forEach(e => console.log(e)); process.exitCode = 1; }
    else console.log('\n--- JS 에러 없음, 관리자 단독 신속처리 시나리오(신차인도서비스 + 신차 케어 서비스 독립) 통과 ---');
  } catch (e) {
    console.log('\n--- 테스트 중 예외 발생 ---');
    console.log(e.message);
    if (errors.length) { console.log('--- 수집된 페이지 에러 ---'); errors.forEach(x => console.log(x)); }
    process.exitCode = 1;
  }

  await browser.close();
})();
