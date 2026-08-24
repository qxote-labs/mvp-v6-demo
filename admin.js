/* admin.js (v6) — 관리자는 전체 현황을 총괄하고, 필요시 어떤 역할의 액션이든 대신 처리할 수 있다
 * (데모 시연 시 신속한 진행을 위함). 신차인도서비스(예약)와 신차 케어 서비스(주문)는 완전히 독립된
 * 최상위 목록이라, 관리자 화면도 이 둘을 별도 탭으로 나눠 각자 목록+상세+대리처리를 제공한다. */
let selectedId = sessionStorage.getItem('v5_admin_sel') || null;
let careSelectedId = sessionStorage.getItem('v5_admin_care_sel') || null;
let loggedInAdmin = sessionStorage.getItem('v5_admin_logged') || null;
let adminTab = sessionStorage.getItem('v5_admin_tab') || 'delivery';
let showNewForm = false;
let showNewCareForm = false;
let adminFillDrafts = {};
let adminOnboardDrafts = {};

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function selectReservation(id) { selectedId = id; showNewForm = false; sessionStorage.setItem('v5_admin_sel', id); render(); }
function selectCareOrder(id) { careSelectedId = id; showNewCareForm = false; sessionStorage.setItem('v5_admin_care_sel', id); render(); }
function setAdminTab(tab) { adminTab = tab; sessionStorage.setItem('v5_admin_tab', tab); render(); }

function renderLogin() {
  return el(`<div>
    <h2>관리자 로그인 (데모)</h2>
    <div class="sub">클릭하면 바로 로그인됩니다.</div>
    <div class="km-grid"><div class="km-card" onclick="tryLogin()"><div class="name">총괄 관리자</div></div></div>
  </div>`);
}
function tryLogin() { loggedInAdmin = '1'; sessionStorage.setItem('v5_admin_logged', '1'); render(); }
function logout() { loggedInAdmin = null; sessionStorage.removeItem('v5_admin_logged'); render(); }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInAdmin) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(renderLogin());
    return;
  }
  const list = Store.getReservations();
  const careList = Store.getCareOrders();
  document.getElementById('header-right').textContent = `신차인도 ${list.length}건 · 신차 케어 ${careList.length}건`;

  root.appendChild(el(`<div class="btn-row" style="justify-content:space-between;">
    <div class="btn-row" style="margin:0;">
      <button class="btn ${adminTab === 'delivery' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="setAdminTab('delivery')">신차인도서비스</button>
      <button class="btn ${adminTab === 'care' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="setAdminTab('care')">신차 케어 서비스</button>
    </div>
    <button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="logout()">로그아웃</button>
  </div>`));

  root.appendChild(adminTab === 'care' ? renderCareTab(careList) : renderDeliveryTab(list));
}

// ===================== 신차인도서비스 탭 =====================
function renderDeliveryTab(list) {
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="btn-row" style="justify-content:flex-end;">
    <button class="btn btn-primary" style="width:auto;padding:13px 26px;" onclick="toggleNewForm()">${showNewForm ? '← 목록으로' : '+ 계약 대리 등록'}</button>
  </div>`));

  const kpiWrap = el(`<div class="kpi-row"></div>`);
  const codeNeeded = list.filter(r => r.stage === '고객요청').length;
  const pendingConfirm = list.filter(r => r.stage === '계약등록').length;
  const releaseReady = list.filter(r => Store.canRequestRelease(r)).length;
  const inTransit = list.filter(r => r.transit && r.transit.active).length;
  const done = list.filter(r => r.stage === '인도완료').length;
  const pointsAwarded = list.reduce((sum, r) => sum + (r.karmasterPointsEarned || 0), 0)
    + Store.getCareOrders().reduce((sum, c) => sum + (c.shopPointsEarned || 0), 0);
  [[list.length, '전체 계약'], [codeNeeded, '카마스터 승인 대기'], [pendingConfirm, '고객확인 대기'], [releaseReady, '출고요청 가능'], [inTransit, '배송중'], [done, '인도 완료'], [fmtPoint(pointsAwarded), '누적 지급 포인트(전체)']].forEach(([v, k]) => {
    kpiWrap.appendChild(el(`<div class="kpi-box"><div class="v">${v}</div><div class="k">${k}</div></div>`));
  });
  wrap.appendChild(kpiWrap);

  if (showNewForm) { wrap.appendChild(renderNewContractForm()); return wrap; }

  if (list.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">📋</div>아직 등록된 계약이 없습니다.</div>`));
    return wrap;
  }

  const split = el(`<div class="split"><div class="side" id="admin-list"></div><div class="main" id="admin-detail"></div></div>`);
  wrap.appendChild(split);

  const listBox = split.querySelector('#admin-list');
  listBox.appendChild(el(`<h3>전체 계약 목록</h3>`));
  const table = el(`<table><tr><th>ID</th><th>고객</th><th>단계</th></tr></table>`);
  list.forEach(r => {
    const tr = elRow(`<tr class="clickable ${r.id === selectedId ? 'active-row' : ''}"><td>${r.id}</td><td>${r.customer.name}</td><td><span class="badge ${stageBadgeClass(r.stage)}">${r.stage}</span></td></tr>`);
    tr.addEventListener('click', () => selectReservation(r.id));
    table.appendChild(tr);
  });
  listBox.appendChild(table);

  const detailBox = split.querySelector('#admin-detail');
  const current = selectedId ? Store.getReservation(selectedId) : null;
  detailBox.appendChild(current ? renderDetail(current) : el(`<div class="empty-state">왼쪽 목록에서 계약을 선택해 주세요.</div>`));
  return wrap;
}
function toggleNewForm() { showNewForm = !showNewForm; render(); }

// ===================== 계약 대리 등록 (카마스터 대신) =====================
let newContractDraft = { karmasterId: null, name: '', phone: '', nickname: '', carModel: '', needsService: null };
function renderNewContractForm() {
  const d = newContractDraft;
  const kmCards = Store.getKarmasters().map(k => `<div class="km-card ${d.karmasterId === k.id ? 'sel' : ''}" onclick="selectDraftKarmaster('${k.id}')"><div class="name">${k.name}</div></div>`).join('');
  const wrap = el(`<div style="max-width:560px;">
    <h3>계약 대리 등록</h3>
    <label>담당 카마스터</label>
    <div class="km-grid">${kmCards}</div>
    <label>고객 실명</label><input id="a-nc-name" type="text" placeholder="홍길동" autocomplete="off">
    <label>고객 연락처</label><input id="a-nc-phone" type="tel" placeholder="010-1234-5678" autocomplete="off">
    <label>확정 차종</label><input id="a-nc-car" type="text" placeholder="예: 쏘렌토 하이브리드" autocomplete="off">
    <div class="btn-row" style="margin-top:8px;">
      <button class="btn btn-sm" id="a-nc-need-y">시공 필요</button>
      <button class="btn btn-sm" id="a-nc-need-n">시공 불필요</button>
    </div>
    <div class="hint" id="a-nc-status"></div>
    <button class="btn btn-primary btn-auto" id="a-nc-submit" style="margin-top:14px;" disabled>계약 대리 등록</button>
  </div>`);
  const nameEl = wrap.querySelector('#a-nc-name'), phoneEl = wrap.querySelector('#a-nc-phone'), carEl = wrap.querySelector('#a-nc-car');
  const statusEl = wrap.querySelector('#a-nc-status'), submitBtn = wrap.querySelector('#a-nc-submit');
  function refreshStatus() { statusEl.textContent = d.needsService === null ? '선택되지 않음' : (d.needsService ? '시공 필요' : '시공 불필요'); }
  function validate() { submitBtn.disabled = !(d.karmasterId && d.name.trim().length >= 2 && /^010-?\d{3,4}-?\d{4}$/.test(d.phone) && d.carModel.trim().length >= 2 && d.needsService !== null); }
  refreshStatus(); validate();
  nameEl.addEventListener('input', () => { d.name = nameEl.value; validate(); });
  phoneEl.addEventListener('input', () => { d.phone = phoneEl.value; validate(); });
  carEl.addEventListener('input', () => { d.carModel = carEl.value; validate(); });
  wrap.querySelector('#a-nc-need-y').addEventListener('click', () => { d.needsService = true; refreshStatus(); validate(); });
  wrap.querySelector('#a-nc-need-n').addEventListener('click', () => { d.needsService = false; refreshStatus(); validate(); });
  wrap.querySelector('#a-nc-submit').addEventListener('click', () => {
    const r = Store.createContractRecordDirect({
      karmasterId: d.karmasterId,
      customer: { name: d.name.trim(), phone: d.phone, nickname: '' },
      carModel: d.carModel.trim(),
      needsService: d.needsService,
    });
    newContractDraft = { karmasterId: null, name: '', phone: '', nickname: '', carModel: '', needsService: null };
    showNewForm = false;
    selectReservation(r.id);
  });
  return wrap;
}
function selectDraftKarmaster(id) { newContractDraft.karmasterId = id; render(); }

function renderDetail(r) {
  const km = Store.getKarmaster(r.karmasterId);
  const careOrders = Store.getCareOrdersByReservation(r.id);
  const wrap = el(`<div>
    <h3>${r.id} · ${r.customer.name} (${r.customer.nickname || ''})</h3>
    <table style="margin-bottom:18px;">
      <tr><th>차종</th><th>카마스터</th><th>출고 후 시공예정</th><th>단계</th><th>연락처</th></tr>
      <tr><td>${r.carModel || '-'}</td><td>${km ? km.name : '-'}</td><td>${r.needsService === null ? '미정' : (r.needsService ? '필요' : '불필요')}</td>
      <td><span class="badge ${stageBadgeClass(r.stage)}">${r.stage}</span></td><td>${r.customer.phone}</td></tr>
    </table>
    ${careOrders.length > 0 ? `<div class="msg-box" style="margin-bottom:14px;"><b>이 차량의 신차 케어 서비스</b> (완전히 별개 계약)<br>${careOrders.map(c => `${c.id} · ${Store.getShop(c.shopId).name} · ${c.status}`).join('<br>')}</div>` : ''}
    ${r.consultMemo ? `<div class="msg-box" style="margin-bottom:14px;"><b>상담 메모</b><br>${r.consultMemo}</div>` : ''}
    <div id="action-slot"></div>
    <details class="admin-controls">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;">전체 처리 이력 보기 (${(r.log || []).length}건)</summary>
      <div style="margin-top:10px;">${renderHistoryLogHTML(r)}</div>
    </details>
  </div>`);

  const slot = wrap.querySelector('#action-slot');
  slot.appendChild(renderAction(r));
  return wrap;
}

function renderAction(r) {
  const box = el(`<div class="admin-controls"><h4>관리자 대리 처리 (신속 진행용)</h4><div id="action-inner"></div></div>`);
  const inner = box.querySelector('#action-inner');

  // 배송 진행중이면 단계와 무관하게 최우선으로 "즉시 도착 처리"를 보여준다.
  if (r.transit && r.transit.active) {
    const tp = transitProgress(r);
    const box2 = el(`<div><div class="hint">목적지: ${tp.destination} · 배송기사: ${tp.driverName} · 다음 위치까지 약 ${tp.remainSec}초</div>
      ${renderDeliveryStepperHTML(r)}
      <button class="btn btn-sm" style="margin-top:8px;">즉시 도착 처리</button></div>`);
    box2.querySelector('button').addEventListener('click', () => { Store.forceArrive(r.id); render(); });
    inner.appendChild(box2);
    return box;
  }

  if (r.stage === '고객요청' && !r.karmasterId) {
    // 고객이 미등록 카마스터를 지정해 시작한 실제 요청 건 — 관리자가 카마스터 등록과 계약 승인을 함께 대리한다.
    const d = adminOnboardDrafts[r.id] || (adminOnboardDrafts[r.id] = { name: '', region: '', needsService: null });
    const form = el(`<div>
      <div class="hint" style="margin-bottom:8px;">미등록 카마스터 연락처: <b>${r.pendingKarmasterPhone}</b> · 조회번호: <b>${r.confirmCode}</b></div>
      <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>
      <label style="margin-top:12px;">카마스터 이름</label><input id="a-ob-name" type="text" autocomplete="off">
      <label>활동 지역</label><input id="a-ob-region" type="text" autocomplete="off">
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn btn-sm" id="a-ob-need-y">시공 필요</button>
        <button class="btn btn-sm" id="a-ob-need-n">시공 불필요</button>
      </div>
      <div class="hint" id="a-ob-status"></div>
      <button class="btn btn-primary btn-sm" id="a-ob-submit" style="margin-top:8px;" disabled>카마스터 대리 등록 + 계약 승인</button>
    </div>`);
    const nameInput = form.querySelector('#a-ob-name'), regionInput = form.querySelector('#a-ob-region');
    const statusEl = form.querySelector('#a-ob-status'), submitBtn = form.querySelector('#a-ob-submit');
    nameInput.value = d.name; regionInput.value = d.region;
    function refreshStatus() { statusEl.textContent = d.needsService === null ? '선택되지 않음' : (d.needsService ? '시공 필요' : '시공 불필요'); }
    function check() { submitBtn.disabled = !(d.name.trim().length >= 2 && d.needsService !== null); }
    refreshStatus(); check();
    nameInput.addEventListener('input', () => { d.name = nameInput.value; check(); });
    regionInput.addEventListener('input', () => { d.region = regionInput.value; });
    form.querySelector('#a-ob-need-y').addEventListener('click', () => { d.needsService = true; refreshStatus(); check(); });
    form.querySelector('#a-ob-need-n').addEventListener('click', () => { d.needsService = false; refreshStatus(); check(); });
    submitBtn.addEventListener('click', () => {
      Store.onboardKarmasterAndFillContract(r.id, { name: d.name.trim(), region: d.region.trim(), needsService: d.needsService, consultMemo: '' });
      delete adminOnboardDrafts[r.id];
      render();
    });
    inner.appendChild(form);
  } else if (r.stage === '고객요청') {
    // 고객이 직접 시작한 실제 요청 건(이미 등록된 카마스터 대상) — 관리자는 카마스터를 대신해 계약
    // 내용을 검토·승인하는 절차를 대리한다.
    const d = adminFillDrafts[r.id] || (adminFillDrafts[r.id] = { needsService: null });
    const form = el(`<div>
      <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn btn-sm" id="a-fill-need-y">시공 필요</button>
        <button class="btn btn-sm" id="a-fill-need-n">시공 불필요</button>
      </div>
      <div class="hint" id="a-fill-status"></div>
      <button class="btn btn-primary btn-sm" id="a-fill-submit" style="margin-top:8px;" disabled>계약 내용 대리 승인</button>
    </div>`);
    const statusEl = form.querySelector('#a-fill-status'), submitBtn = form.querySelector('#a-fill-submit');
    function refreshStatus() { statusEl.textContent = d.needsService === null ? '선택되지 않음' : (d.needsService ? '시공 필요' : '시공 불필요'); }
    function check() { submitBtn.disabled = d.needsService === null; }
    refreshStatus(); check();
    form.querySelector('#a-fill-need-y').addEventListener('click', () => { d.needsService = true; refreshStatus(); check(); });
    form.querySelector('#a-fill-need-n').addEventListener('click', () => { d.needsService = false; refreshStatus(); check(); });
    submitBtn.addEventListener('click', () => {
      Store.fillContractDetails(r.id, { needsService: d.needsService, consultMemo: '' });
      delete adminFillDrafts[r.id];
      render();
    });
    inner.appendChild(form);
  } else if (r.stage === '계약등록') {
    const btn = el(`<button class="btn btn-primary btn-sm">고객 확인 대리 처리 →</button>`);
    btn.addEventListener('click', () => { Store.confirmContractByCustomer(r.id); render(); });
    inner.appendChild(btn);
  } else if (r.stage === '계약확정' && !r.ownerReleaseRequested) {
    const btn = el(`<button class="btn btn-primary btn-sm">고객 출고 요청 대리 처리</button>`);
    btn.addEventListener('click', () => { Store.requestOwnerRelease(r.id); render(); });
    inner.appendChild(btn);
  } else if (Store.canRequestRelease(r)) {
    const btn = el(`<button class="btn btn-primary btn-sm">출고 요청 대리 처리 →</button>`);
    btn.addEventListener('click', () => { Store.requestRelease(r.id); render(); });
    inner.appendChild(btn);
  } else if (r.stage === '시공중') {
    const box = el(`<div><div class="hint" style="margin-bottom:8px;">차량이 ${r.karmasterShopName || '지정업체'}에 도착했습니다 — 카마스터-업체 간 별개 거래이며 고객은 관여하지 않습니다.</div><button class="btn btn-primary btn-sm">시공완료 확인 대리 처리 →</button></div>`);
    box.querySelector('button').addEventListener('click', () => { Store.confirmKarmasterShopDone(r.id); render(); });
    inner.appendChild(box);
  } else if (r.stage === '수령확인대기') {
    const btn = el(`<button class="btn btn-primary btn-sm">수령 확인 대리 처리</button>`);
    btn.addEventListener('click', () => { Store.confirmDelivery(r.id); render(); });
    inner.appendChild(btn);
  } else if (r.stage === '인도완료') {
    if (!r.karmasterRated) {
      const btn = el(`<button class="btn btn-sm">카마스터 평가 대리 제출 (포인트 자동 적립)</button>`);
      btn.addEventListener('click', () => {
        const scores = {}; RATING_DIMS_KARMASTER.forEach(d => scores[d.id] = 5);
        Store.submitRating('karmaster', r.karmasterId, r.id, scores, '');
        render();
      });
      inner.appendChild(btn);
    } else {
      inner.appendChild(el(`<div class="hint">이 건은 완료되었습니다.</div>`));
    }
  } else {
    inner.appendChild(el(`<div class="hint">이 건은 대기중입니다.</div>`));
  }
  return box;
}

// ===================== 신차 케어 서비스 탭 (신차인도서비스와 완전히 독립된 최상위 목록) =====================
function renderCareTab(careList) {
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="btn-row" style="justify-content:flex-end;">
    <button class="btn btn-primary" style="width:auto;padding:13px 26px;" onclick="toggleNewCareForm()">${showNewCareForm ? '← 목록으로' : '+ 신차 케어 서비스 대리 신청'}</button>
  </div>`));

  const kpiWrap = el(`<div class="kpi-row"></div>`);
  const quoteWaiting = careList.filter(c => c.status === 'requested').length;
  const confirmWaitingCustomer = careList.filter(c => c.status === 'quoted').length;
  const active = careList.filter(c => SHOP_DISPLAY_STAGES.some(s => s.code === c.status)).length;
  const confirmWaiting = careList.filter(c => ['고객검수대기', '수령대기'].includes(c.status)).length;
  const disputes = careList.filter(c => c.disputed).length;
  const done = careList.filter(c => c.status === '수령확인' && c.shopRated).length;
  [[careList.length, '전체 신청'], [quoteWaiting, '견적 대기'], [confirmWaitingCustomer, '고객확인 대기'], [active, '진행중 시공'], [confirmWaiting, '확인 대기'], [disputes, '품질 이의제기'], [done, '완료']].forEach(([v, k]) => {
    kpiWrap.appendChild(el(`<div class="kpi-box"><div class="v">${v}</div><div class="k">${k}</div></div>`));
  });
  wrap.appendChild(kpiWrap);

  if (showNewCareForm) { wrap.appendChild(renderNewCareForm()); return wrap; }

  if (careList.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">🛠️</div>아직 신청된 신차 케어 서비스가 없습니다.</div>`));
    return wrap;
  }

  const split = el(`<div class="split"><div class="side" id="admin-care-list"></div><div class="main" id="admin-care-detail"></div></div>`);
  wrap.appendChild(split);

  const listBox = split.querySelector('#admin-care-list');
  listBox.appendChild(el(`<h3>전체 신청 목록</h3>`));
  const table = el(`<table><tr><th>ID</th><th>고객</th><th>상태</th></tr></table>`);
  careList.forEach(c => {
    const tr = elRow(`<tr class="clickable ${c.id === careSelectedId ? 'active-row' : ''}"><td>${c.id}</td><td>${c.customer.name}</td><td><span class="badge ${amBadgeClass(c.status)}">${c.status}</span></td></tr>`);
    tr.addEventListener('click', () => selectCareOrder(c.id));
    table.appendChild(tr);
  });
  listBox.appendChild(table);

  const detailBox = split.querySelector('#admin-care-detail');
  const current = careSelectedId ? Store.getCareOrder(careSelectedId) : null;
  detailBox.appendChild(current ? renderCareDetail(current) : el(`<div class="empty-state">왼쪽 목록에서 신청 건을 선택해 주세요.</div>`));
  return wrap;
}
function toggleNewCareForm() { showNewCareForm = !showNewCareForm; render(); }

// 신차 케어 서비스는 "내 차량"(=신차인도서비스 예약) 중 하나를 골라 시작한다 — 관리자는 전체
// 예약 중에서 대신 고를 수 있다.
let newCareDraft = { reservationId: null };
function renderNewCareForm() {
  const d = newCareDraft;
  const cars = Store.getReservations();
  const carCards = cars.map(r => `<div class="km-card ${d.reservationId === r.id ? 'sel' : ''}" onclick="selectDraftCar('${r.id}')"><div class="name">${r.carModel || '차종 미정'}</div><div class="rating">${r.id} · ${r.customer.name}</div></div>`).join('');
  const shop = Store.getShops()[0];
  const wrap = el(`<div style="max-width:560px;">
    <h3>신차 케어 서비스 대리 신청</h3>
    <label>대상 차량 (신차인도서비스 예약)</label>
    <div class="km-grid">${carCards || '<div class="hint">등록된 차량(신차인도서비스 예약)이 없습니다.</div>'}</div>
    <button class="btn btn-primary btn-auto" id="a-care-submit" style="margin-top:14px;" ${!d.reservationId ? 'disabled' : ''}>대리 신청 (${shop.name}, 스탠다드, 온라인 즉시견적)</button>
  </div>`);
  wrap.querySelector('#a-care-submit').addEventListener('click', () => {
    const order = Store.requestCareOrder({ reservationId: d.reservationId, shopId: shop.id, mode: 'online', packageId: PACKAGES[1].id, optionIds: [], customRequest: '' });
    newCareDraft = { reservationId: null };
    showNewCareForm = false;
    selectCareOrder(order.id);
  });
  return wrap;
}
function selectDraftCar(id) { newCareDraft.reservationId = id; render(); }

function renderCareDetail(c) {
  const shop = Store.getShop(c.shopId);
  const wrap = el(`<div>
    <h3>${c.id} · ${c.customer.name}</h3>
    <table style="margin-bottom:18px;">
      <tr><th>차종</th><th>시공사</th><th>상태</th></tr>
      <tr><td>${c.carModel || '-'}</td><td>${shop ? shop.name : '-'}</td><td><span class="badge ${amBadgeClass(c.status)}">${c.status}</span></td></tr>
    </table>
    ${c.customRequest ? `<div class="msg-box" style="margin-bottom:14px;"><b>요청사항</b><br>${c.customRequest}</div>` : ''}
    <div id="care-action-slot"></div>
    <details class="admin-controls">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;">전체 처리 이력 보기 (${(c.log || []).length}건)</summary>
      <div style="margin-top:10px;">${renderHistoryLogHTML(c)}</div>
    </details>
  </div>`);
  wrap.querySelector('#care-action-slot').appendChild(renderCareAction(c));
  return wrap;
}

function renderCareAction(c) {
  const box = el(`<div class="admin-controls"><h4>관리자 대리 처리 (신속 진행용)</h4><div id="care-action-inner"></div></div>`);
  const inner = box.querySelector('#care-action-inner');

  if (c.transit && c.transit.active) {
    const tp = transitProgress(c);
    const box2 = el(`<div><div class="hint">목적지: ${tp.destination} · 배송기사: ${tp.driverName} · 다음 위치까지 약 ${tp.remainSec}초</div>
      ${renderDeliveryStepperHTML(c)}
      <button class="btn btn-sm" style="margin-top:8px;">즉시 도착 처리</button></div>`);
    box2.querySelector('button').addEventListener('click', () => { Store.forceArrive(c.id); render(); });
    inner.appendChild(box2);
    return box;
  }

  if (c.status === 'requested') {
    const suggested = Store.aftermarketSuggestedPrice(c);
    const btn = el(`<button class="btn btn-primary btn-sm">견적 대리 회신 (${fmtMoney(suggested)})</button>`);
    btn.addEventListener('click', () => { Store.respondCareQuote(c.id, suggested); render(); });
    inner.appendChild(btn);
  } else if (c.status === 'quoted') {
    const btn = el(`<button class="btn btn-primary btn-sm">고객 견적 확인 대리 처리</button>`);
    btn.addEventListener('click', () => { Store.confirmCareQuote(c.id, 0); render(); });
    inner.appendChild(btn);
  } else if (c.status === 'confirmed') {
    const btn = el(`<button class="btn btn-primary btn-sm">입고 대리 확인</button>`);
    btn.addEventListener('click', () => { Store.confirmCareDropoff(c.id); render(); });
    inner.appendChild(btn);
  } else if (SHOP_STAGES.some(s => s.code === c.status)) {
    const idx = SHOP_STAGES.findIndex(s => s.code === c.status);
    const flowBox = el(`<div class="status-flow"></div>`);
    SHOP_STAGES.forEach((s, i) => {
      const btn = el(`<button class="${s.code === c.status ? 'current' : ''}" ${i !== idx + 1 ? 'disabled' : ''}>${s.short}</button>`);
      btn.addEventListener('click', () => { Store.setCareShopStage(c.id, s.code); render(); });
      flowBox.appendChild(btn);
    });
    inner.appendChild(flowBox);
    if (c.status === '최종검수') {
      const priceBtn = el(`<button class="btn btn-sm" style="margin-top:8px;">청구액 = 견적가로 대리 입력 (${fmtMoney(c.quotedPrice)})</button>`);
      priceBtn.addEventListener('click', () => { Store.setCareCharged(c.id, 0, ''); render(); });
      inner.appendChild(priceBtn);
      const reqBtn = el(`<button class="btn btn-sm" style="margin-top:8px;">고객 검수 요청 대리 발송</button>`);
      reqBtn.addEventListener('click', () => { Store.requestCareInspection(c.id); render(); });
      inner.appendChild(reqBtn);
    }
    inner.insertAdjacentHTML('beforeend', `<div style="margin-top:14px;">${renderShopTimelineHTML(c)}</div>`);
  } else if (c.status === '고객검수대기') {
    const box2 = el(`<div>
      <div class="hint" style="margin-bottom:8px;">출차 전 고객 검수 확인이 필요합니다 (오너 단독).</div>
      <span class="badge ${c.ownerConfirmed ? 'done' : 'wait'}">${c.ownerConfirmed ? '완료' : '대기'}</span>
      ${c.disputed ? `<div class="msg-box" style="border-left-color:#c22;margin:8px 0;">⚠ 이의제기: ${c.disputeReason}<br><button class="btn btn-sm" id="a-resolve-dispute" style="margin-top:6px;">이의제기 처리 완료로 표시</button></div>` : ''}
      <div class="btn-row" style="margin-top:8px;">${!c.ownerConfirmed ? `<button class="btn btn-sm" id="a-owner-inspect">오너 검수 대리 확인</button>` : ''}</div>
      ${renderShopTimelineHTML(c)}
    </div>`);
    const ob = box2.querySelector('#a-owner-inspect'); if (ob) ob.addEventListener('click', () => { Store.ownerConfirmCare(c.id); render(); });
    const rd = box2.querySelector('#a-resolve-dispute'); if (rd) rd.addEventListener('click', () => { Store.resolveCareDispute(c.id); render(); });
    inner.appendChild(box2);
  } else if (c.status === '출차완료') {
    const box2 = el(`<div>${renderShopTimelineHTML(c)}<button class="btn btn-primary btn-sm" style="margin-top:8px;">2차 배송(오너) 대리 시작</button></div>`);
    box2.querySelector('button').addEventListener('click', () => { Store.startCareSecondLeg(c.id); render(); });
    inner.appendChild(box2);
  } else if (c.status === '수령대기') {
    const btn = el(`<button class="btn btn-sm">오너 수령 대리 확인</button>`);
    btn.addEventListener('click', () => { Store.ownerConfirmCare(c.id); render(); });
    inner.appendChild(btn);
  } else if (c.status === '수령확인') {
    if (c.priceMatch === null || c.priceMatch === undefined) {
      const b = el(`<button class="btn btn-sm">정찰제 일치 대리 확인</button>`);
      b.addEventListener('click', () => { Store.answerCarePriceCheck(c.id, true); render(); });
      inner.appendChild(b);
    } else if (c.disputed) {
      inner.appendChild(el(`<div class="hint">정찰제 불일치가 접수된 건입니다.</div>`));
    } else if (!c.shopRated) {
      const b = el(`<button class="btn btn-sm">시공사 평가 대리 제출 (포인트 자동 적립)</button>`);
      b.addEventListener('click', () => {
        const scores = {}; RATING_DIMS_SHOP.forEach(d => scores[d.id] = 5);
        Store.submitRating('shop', c.shopId, c.id, scores, '');
        render();
      });
      inner.appendChild(b);
    } else {
      inner.appendChild(el(`<div class="hint">정찰제 확인·평가·포인트 적립까지 완료된 건입니다.</div>`));
    }
  } else {
    inner.appendChild(el(`<div class="hint">이 건은 대기중입니다.</div>`));
  }
  return box;
}

Store.onChange(() => { render(); });
render();
