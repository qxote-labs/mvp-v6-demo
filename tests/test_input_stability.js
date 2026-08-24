const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8000/customer.html');
  await page.click('text=간편 로그인');
  await page.click('text=계약내역 등록하기');
  await page.waitForSelector('#rq-name');

  // 입력 필드 DOM 노드에 마커를 심어, 폴링에 의한 재렌더링으로 노드가 통째로 교체되는지 확인한다.
  await page.evaluate(() => { document.querySelector('#rq-name').__markedNode = true; });

  // 실제 사용자가 타이핑하듯 한 글자씩 지연을 두고 입력 (폴링 주기 500ms를 여러 번 통과하도록 총 2초 이상 소요)
  await page.type('#rq-name', '홍길동테스트', { delay: 350 });

  const stillSameNode = await page.evaluate(() => document.querySelector('#rq-name').__markedNode === true);
  const finalValue = await page.inputValue('#rq-name');
  console.log('입력 도중 노드 교체 여부(마커 유지 = 안 바뀜):', stillSameNode ? '노드 유지됨 (정상)' : '노드가 교체됨 (버그)');
  console.log('최종 입력값:', finalValue);

  if (!stillSameNode || finalValue !== '홍길동테스트') {
    console.log('\n--- 입력 안정성 테스트 실패 ---');
    process.exitCode = 1;
  } else if (errors.length) {
    console.log('\n--- JS 에러 발견 ---'); errors.forEach(e => console.log(e)); process.exitCode = 1;
  } else {
    console.log('\n--- 입력 안정성 테스트 통과: 폴링 중에도 계약 요청 폼 입력 필드가 끊기지 않음 ---');
  }

  await browser.close();
})();
