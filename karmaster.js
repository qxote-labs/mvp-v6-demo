/* karmaster.js (v6.2) — 계약은 반드시 고객이 시작한다. 이미 오프라인에서 체결된 계약의 내용(차량정보·
 * 계약일자·고객정보)을 고객이 앱에 등록하면, 등록된 카마스터라면 별도 코드 확인 없이 담당 목록에서 그
 * 내용을 검토하고 승인하는 것으로 연결된다 — 화면에 뜬 내용이 실제 계약서와 맞는지 눈으로 확인하는 게
 * 검증 수단이다. 아직 미등록인 카마스터는 고객에게 직접 전달받은 조회번호로 찾아 가입과 동시에 승인한다.
 * 카마스터의 역할은 출고 요청과 배송 모니터링까지이며, 오너가 차량 수령을 확인하는 순간 끝난다 —
 * 출고 후 시공이 예정된 건이라도, 그 시공(신차 케어 서비스)은 고객·시공사 간 별개의 계약이라 카마스터는
 * 관여하지 않는다. */

let loggedInId = sessionStorage.getItem('v5_km_id') || null;
let selectedId = sessionStorage.getItem('v5_km_sel') || null;
let showOnboard = false;
let kmSearchQuery = '';

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function _renderInner() {
  const root = document.getElementById('body-root');
  // 실시간 검색/조회 입력은 매 글자마다 render()를 다시 호출하는데, 그때마다 DOM을 통째로 교체하면
  // 입력 중이던 필드가 포커스를 잃는다 — 재렌더링 전후로 포커스·커서 위치를 복원한다.
  const focused = document.activeElement;
  let restore = null;
  if (focused && root.contains(focused) && focused.id && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA')) {
    restore = { id: focused.id, value: focused.value, selStart: typeof focused.selectionStart === 'number' ? focused.selectionStart : null, selEnd: typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null };
  }
  root.innerHTML = '';
  if (!loggedInId) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(showOnboard ? renderOnboard() : renderLogin());
  } else {
    const km = Store.getKarmaster(loggedInId);
    document.getElementById('header-right').textContent = `${km.name} 로그인중`;
    root.appendChild(renderDashboard(km));
  }
  if (restore) {
    const restored = document.getElementById(restore.id);
    if (restored) {
      restored.value = restore.value;
      restored.focus();
      if (restore.selStart !== null && restored.setSelectionRange) { try { restored.setSelectionRange(restore.selStart, restore.selEnd); } catch (e) {} }
    }
  }
}

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}

// 실제 서비스와 동일하게 연락처 입력으로 로그인하는 화면을 기본으로 두고, 테스트 시 매번 번호를
// 외워 입력하는 번거로움을 줄이기 위해 그 아래에 평소엔 접혀 있는 "빠른 로그인" 드롭다운만 덧붙인다
// — 카드 여러 개를 늘어놓고 고르던 기존 방식보다 실제 로그인 흐름에 더 가깝다.
function renderLogin() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">카마스터 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 연락처로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleOnboard()">아직 계정이 없으신가요? 조회번호로 첫 계약 등록하기</button>
    </div>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:11.5px;color:#888;">테스트 계정으로 빠른 로그인</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getKarmasters().map(k => `<option value="${k.id}">${k.name} · ${k.phone}</option>`).join('')}
      </select>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  submitBtn.addEventListener('click', () => {
    const km = Store.getKarmasterByPhone(phoneEl.value);
    if (!km) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    tryLogin(km.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function toggleOnboard() { showOnboard = !showOnboard; onboardDraft = { token: '', name: '', region: '', needsService: null, consultMemo: '', shopName: '' }; render(); }

// ===================== 미등록 카마스터 온보딩 (조회번호로 가입과 동시에 계약 연결) =====================
// 고객에게 직접 전달받은 조회번호로 그 요청을 찾는다. 보안은 번호를 아는 것 자체가 아니라, 이어지는
// 화면에서 차량정보·계약일자·고객정보를 직접 눈으로 검토하고 승인하는 데서 나온다.
let onboardDraft = { token: '', name: '', region: '', needsService: null, consultMemo: '', shopName: '' };
function renderOnboard() {
  const d = onboardDraft;
  const found = d.token.trim().length === 6 ? Store.getReservationByToken(d.token.trim()) : null;
  const wrap = el(`<div style="max-width:520px;">
    <h2>조회번호로 첫 계약 등록</h2>
    <div class="sub">고객에게 전달받은 조회번호를 입력하세요. 아직 이 서비스에 등록되지 않은 카마스터도 가입과 계약 승인을 한 번에 할 수 있습니다.</div>
    <label>조회번호</label>
    <input id="ob-token" type="text" maxlength="6" placeholder="예: 482913" autocomplete="off">
    <div class="hint" id="ob-token-hint"></div>
    <div id="ob-form-slot"></div>
    <div class="btn-row" style="margin-top:16px;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleOnboard()">← 로그인 화면으로</button>
    </div>
  </div>`);
  const tokenEl = wrap.querySelector('#ob-token'), tokenHint = wrap.querySelector('#ob-token-hint');
  const formSlot = wrap.querySelector('#ob-form-slot');
  tokenEl.value = d.token;
  tokenEl.addEventListener('input', () => { d.token = tokenEl.value.replace(/[^0-9]/g, '').slice(0, 6); tokenEl.value = d.token; render(); });

  if (d.token.trim().length === 6 && !found) {
    tokenHint.textContent = '일치하는 요청을 찾을 수 없습니다. 번호를 다시 확인해주세요.';
  } else if (found) {
    tokenHint.textContent = '요청을 찾았습니다 — 아래 내용이 실제 계약과 맞는지 확인해 주세요.';
    const form = el(`<div class="admin-controls" style="margin-top:12px;">
      <h4>등록된 계약 내용 (고객 입력)</h4>
      <div class="summary-line"><span>고객</span><span>${found.customer.name} (${found.customer.phone})</span></div>
      <div class="summary-line"><span>차량</span><span>${found.carModel}${found.trim ? ` · ${found.trim}` : ''}${found.color ? ` · ${found.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${found.contractDate || '-'}</span></div>

      <label style="margin-top:16px;">본인 이름</label>
      <input id="ob-name" type="text" placeholder="본인 이름" autocomplete="off">
      <label>활동 지역</label>
      <input id="ob-region" type="text" placeholder="예: 울산" autocomplete="off">
      <label>출고 후 시공예정 여부</label>
      <div class="btn-row" style="margin-top:0;">
        <button class="btn btn-sm" id="ob-need-y">시공 필요</button>
        <button class="btn btn-sm" id="ob-need-n">시공 불필요</button>
      </div>
      <div class="hint" id="ob-need-status"></div>
      <label>지정업체명 (선택 — 시공 필요 시, 카마스터와 그 업체 간 별개 거래이며 고객에게는 노출되지 않습니다)</label>
      <input id="ob-shop" type="text" placeholder="예: OO오토라운지" autocomplete="off">
      <label>상담 메모 (선택)</label>
      <textarea id="ob-memo" rows="3"></textarea>
      <button class="btn btn-primary btn-sm" id="ob-submit" style="margin-top:10px;" disabled>가입하고 계약 승인</button>
    </div>`);
    const nameEl = form.querySelector('#ob-name'), regionEl = form.querySelector('#ob-region');
    const memoEl = form.querySelector('#ob-memo'), shopEl = form.querySelector('#ob-shop');
    const statusEl = form.querySelector('#ob-need-status'), submitBtn = form.querySelector('#ob-submit');
    nameEl.value = d.name; regionEl.value = d.region; memoEl.value = d.consultMemo; shopEl.value = d.shopName;
    function refreshStatus() { statusEl.textContent = d.needsService === null ? '선택되지 않음' : (d.needsService ? '시공 필요로 합의됨' : '시공 없이 차량만 구매로 합의됨'); }
    function validate() { submitBtn.disabled = !(d.name.trim().length >= 2 && d.needsService !== null); }
    refreshStatus(); validate();
    nameEl.addEventListener('input', () => { d.name = nameEl.value; validate(); });
    regionEl.addEventListener('input', () => { d.region = regionEl.value; });
    memoEl.addEventListener('input', () => { d.consultMemo = memoEl.value; });
    shopEl.addEventListener('input', () => { d.shopName = shopEl.value; });
    form.querySelector('#ob-need-y').addEventListener('click', () => { d.needsService = true; refreshStatus(); validate(); });
    form.querySelector('#ob-need-n').addEventListener('click', () => { d.needsService = false; refreshStatus(); validate(); });
    submitBtn.addEventListener('click', () => {
      const updated = Store.onboardKarmasterAndFillContract(found.id, {
        name: d.name.trim(), region: d.region.trim(),
        needsService: d.needsService, consultMemo: d.consultMemo, karmasterShopName: d.shopName.trim(),
      });
      showOnboard = false;
      loggedInId = updated.karmasterId;
      sessionStorage.setItem('v5_km_id', loggedInId);
      selectReservation(updated.id);
    });
    formSlot.appendChild(form);
  }
  return wrap;
}
function tryLogin(id) { loggedInId = id; sessionStorage.setItem('v5_km_id', id); render(); }
function logout() { loggedInId = null; selectedId = null; sessionStorage.removeItem('v5_km_id'); sessionStorage.removeItem('v5_km_sel'); render(); }
function selectReservation(id) {
  selectedId = id;
  sessionStorage.setItem('v5_km_sel', id);
  Store.markMessagesRead(id);
  render();
}

function stageStepLabel(r) {
  const map = {
    '고객요청': '① 승인 필요',
    '계약등록': '② 고객 확인 대기',
    '계약확정': Store.canRequestRelease(r) ? '③ 출고 요청 가능' : '③ 고객 출고요청 대기',
    '배송중': '④ 배송중',
    '시공중': '④ 지정업체 시공중 (카마스터 확인 대기)',
    '수령확인대기': '⑤ 고객 도착 확인 대기',
    '인도완료': '완료 (신차인도서비스 종료)',
  };
  return map[r.stage] || r.stage;
}

function renderDashboard(km) {
  const list = Store.getReservationsByKarmaster(km.id);
  const approvalNeeded = list.filter(r => r.stage === '고객요청').length;
  const confirmWaiting = list.filter(r => r.stage === '계약등록').length;
  const releaseNeeded = list.filter(r => Store.canRequestRelease(r)).length;
  const unreadMsg = list.filter(r => r.karmasterUnread).length;
  const doneCount = list.filter(r => r.stage === '인도완료').length;

  const wrap = el(`<div>
    <div class="btn-row" style="justify-content:flex-end;">
      <button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="logout()">로그아웃</button>
    </div>
    <div class="kpi-row">
      <div class="kpi-box"><div class="v">${list.length}</div><div class="k">전체 담당 고객</div></div>
      <div class="kpi-box"><div class="v">${approvalNeeded}</div><div class="k">승인 필요</div></div>
      <div class="kpi-box"><div class="v">${confirmWaiting}</div><div class="k">고객 확인 대기</div></div>
      <div class="kpi-box"><div class="v">${releaseNeeded}</div><div class="k">출고 요청 가능</div></div>
      <div class="kpi-box"><div class="v">${unreadMsg}</div><div class="k">읽지 않은 메시지</div></div>
      <div class="kpi-box"><div class="v">${doneCount}</div><div class="k">인도 완료</div></div>
    </div>
    <div class="split"><div class="side" id="km-list"></div><div class="main" id="km-detail"></div></div>
  </div>`);

  const listBox = wrap.querySelector('#km-list');
  listBox.appendChild(el(`<h3>담당 고객 목록</h3>`));
  if (list.length === 0) {
    listBox.appendChild(el(`<div class="hint">아직 등록된 계약이 없습니다. 고객이 계약 체결 후 앱에 계약내역을 등록하면 여기 나타납니다.</div>`));
  } else {
    const searchBox = el(`<input id="km-search" type="text" placeholder="계약번호·고객이름·연락처로 검색" style="margin-bottom:10px;" autocomplete="off">`);
    searchBox.value = kmSearchQuery;
    searchBox.addEventListener('input', () => { kmSearchQuery = searchBox.value; render(); });
    listBox.appendChild(searchBox);

    const q = kmSearchQuery.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    const filtered = !q ? list : list.filter(r =>
      r.id.toLowerCase().includes(q) ||
      r.customer.name.toLowerCase().includes(q) ||
      (qDigits && r.customer.phone.replace(/[^0-9]/g, '').includes(qDigits))
    );

    if (filtered.length === 0) {
      listBox.appendChild(el(`<div class="hint">검색 결과가 없습니다.</div>`));
    } else {
      const table = el(`<table><tr><th>고객</th><th>단계</th><th>메시지</th></tr></table>`);
      filtered.forEach(r => {
        const tr = elRow(`<tr class="clickable ${r.id === selectedId ? 'active-row' : ''}">
          <td>${r.customer.name}<br><span style="font-size:10.5px;color:#888;">${r.id} · ${r.carModel || '차종 미정'}</span></td>
          <td><span class="badge ${stageBadgeClass(r.stage)}">${stageStepLabel(r)}</span></td>
          <td>${r.karmasterUnread ? '<span class="badge wait">🔔 신규</span>' : (r.messages && r.messages.length ? `${r.messages.length}건` : '-')}</td>
        </tr>`);
        tr.addEventListener('click', () => selectReservation(r.id));
        table.appendChild(tr);
      });
      listBox.appendChild(table);
    }
  }

  const detailBox = wrap.querySelector('#km-detail');
  const current = selectedId ? Store.getReservation(selectedId) : null;
  detailBox.appendChild((current && current.karmasterId === km.id) ? renderCustomerDetail(current) : el(`<div class="empty-state">왼쪽 목록에서 고객을 선택해 주세요.</div>`));

  return wrap;
}

// ===================== 계약 검토·승인 (고객요청 단계) =====================
// 고객이 이미 입력해둔 계약 내용(차량정보·계약일자·본인정보)을 그대로 보여준다. 카마스터는 이게
// 실제로 자신이 체결한 계약과 일치하는지 눈으로 확인한 뒤 승인하면 된다 — 별도의 코드를 입력할
// 필요는 없다. 화면에 뜬 내용 자체가 이미 그 계약서를 양쪽 다 들고 있어야만 맞출 수 있는 조합이다.
let approveDrafts = {};
function renderApprovalReview(r) {
  const d = approveDrafts[r.id] || (approveDrafts[r.id] = { needsService: null, consultMemo: '', shopName: '' });
  const card = el(`<div>
    <h3>${r.customer.name} (${r.customer.nickname || '-'}) · ${r.id}</h3>
    <div class="hint" style="margin-bottom:16px;">연락처: ${r.customer.phone} — 고객이 직접 입력한 정보입니다.</div>
    <div class="admin-controls">
      <h4>고객이 등록한 계약 내용</h4>
      <div class="hint" style="margin-bottom:8px;">아래 내용이 실제로 체결하신 계약과 맞는지 확인한 뒤 승인해 주세요.</div>
      <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>

      <label style="margin-top:16px;">출고 후 시공예정 여부</label>
      <div class="btn-row" style="margin-top:0;">
        <button class="btn btn-sm" id="km-need-y-${r.id}">시공 필요</button>
        <button class="btn btn-sm" id="km-need-n-${r.id}">시공 불필요</button>
      </div>
      <div class="hint" id="km-need-status-${r.id}"></div>
      <label>지정업체명 (선택 — 시공 필요 시, 카마스터와 그 업체 간 별개 거래이며 고객에게는 노출되지 않습니다)</label>
      <input id="km-shop-${r.id}" type="text" placeholder="예: OO오토라운지" autocomplete="off">
      <label>상담 메모 (선택)</label>
      <textarea id="km-memo-${r.id}" rows="3" placeholder="예: 색상 변경 희망, 인도 희망일, 트레이드인 문의 등"></textarea>
      <button class="btn btn-primary btn-sm" id="km-fill-submit-${r.id}" style="margin-top:10px;" disabled>계약 내용 승인</button>
    </div>
    <div id="km-approve-message"></div>
  </div>`);
  card.querySelector('#km-approve-message').appendChild(renderMessageCard(r));

  const memoEl = card.querySelector(`#km-memo-${r.id}`), shopEl = card.querySelector(`#km-shop-${r.id}`);
  const statusEl = card.querySelector(`#km-need-status-${r.id}`), submitBtn = card.querySelector(`#km-fill-submit-${r.id}`);
  memoEl.value = d.consultMemo; shopEl.value = d.shopName;

  function refreshStatus() { statusEl.textContent = d.needsService === null ? '선택되지 않음' : (d.needsService ? '시공 필요로 합의됨' : '시공 없이 차량만 구매로 합의됨'); }
  function validate() { submitBtn.disabled = d.needsService === null; }
  refreshStatus(); validate();

  memoEl.addEventListener('input', () => { d.consultMemo = memoEl.value; });
  shopEl.addEventListener('input', () => { d.shopName = shopEl.value; });
  card.querySelector(`#km-need-y-${r.id}`).addEventListener('click', () => { d.needsService = true; refreshStatus(); validate(); });
  card.querySelector(`#km-need-n-${r.id}`).addEventListener('click', () => { d.needsService = false; refreshStatus(); validate(); });
  submitBtn.addEventListener('click', () => {
    Store.fillContractDetails(r.id, { needsService: d.needsService, consultMemo: d.consultMemo, karmasterShopName: d.shopName.trim() });
    delete approveDrafts[r.id];
    render();
  });
  return card;
}

// ===================== 고객 상세 (선택된 1명) =====================
function renderCustomerDetail(r) {
  if (r.stage === '고객요청') return renderApprovalReview(r);

  const wrap = el(`<div>
    <h3>${r.customer.name} (${r.customer.nickname || '-'}) · ${r.id}</h3>
    <div class="hint" style="margin-bottom:16px;">연락처: ${r.customer.phone} · 현재 단계: <b>${stageStepLabel(r)}</b></div>
    <div id="section-contract"></div>
    <div id="section-journey"></div>
    <details class="admin-controls" style="margin-top:16px;">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;">실시간 이력 보기 (${(r.log || []).length}건)</summary>
      <div style="margin-top:10px;">${renderHistoryLogHTML(r)}</div>
    </details>
    <div id="section-message"></div>
  </div>`);

  // ① 계약 내용
  const contractBox = wrap.querySelector('#section-contract');
  contractBox.appendChild(el(`<div class="admin-controls">
    <h4>① 승인한 계약 내용</h4>
    <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
    <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>
    <div class="summary-line"><span>출고 후 시공예정</span><span>${r.needsService ? '필요' : '불필요'}</span></div>
    ${r.needsService && r.karmasterShopName ? `<div class="summary-line"><span>지정업체</span><span>${r.karmasterShopName} (고객 비노출)</span></div>` : ''}
    ${r.consultMemo ? `<div class="msg-box" style="margin-top:8px;"><b>상담 메모</b><br>${r.consultMemo}</div>` : ''}
    <span class="badge ${r.stage === '계약등록' ? 'wait' : 'done'}" style="margin-top:8px;display:inline-block;">${r.stage === '계약등록' ? '고객 확인 대기중' : '고객 확인 완료'}</span>
  </div>`));

  // 계약이 확정됐다고 곧바로 출고가 시작되지 않는다 — 고객이 먼저 최종 수령지와 함께 "출고 요청"을
  // 해야만 카마스터가 공장에 출고를 의뢰할 수 있다. 신차 케어 서비스 진행 상태는 이 게이트와 무관하다.
  if (r.stage === '계약확정' && !r.ownerReleaseRequested) {
    contractBox.appendChild(el(`<div class="admin-controls">
      <h4>출고 요청 대기중</h4>
      <div class="hint">고객이 아직 출고를 요청하지 않았습니다. 고객이 최종 수령지를 정해 "차량 출고 요청하기"를 누르면 여기서 공장에 출고를 의뢰할 수 있습니다.</div>
    </div>`));
  }

  if (Store.canRequestRelease(r)) {
    const relBox = el(`<div class="admin-controls">
      <h4>출고 요청</h4>
      <div class="hint" style="margin-bottom:8px;">고객이 출고를 요청했습니다${r.deliveryAddress ? ` — 최종 수령지: <b>${r.deliveryAddress}</b>` : ''}. 공장에 출고를 의뢰하면 배송기사가 배정되고 배송이 시작됩니다.</div>
      <button class="btn btn-primary btn-sm" id="km-release-${r.id}">공장에 출고 의뢰하기 →</button>
    </div>`);
    relBox.querySelector(`#km-release-${r.id}`).addEventListener('click', () => { Store.requestRelease(r.id); render(); });
    contractBox.appendChild(relBox);
  }

  // ② 배송/인도 진행 현황 — 카마스터는 수령확인대기(오너 도착 확인)까지만 지켜본다.
  const journeyBox = wrap.querySelector('#section-journey');
  if (r.stage === '배송중') {
    const tp = transitProgress(r);
    const card = el(`<div class="admin-controls" data-rid="${r.id}">
      <h4>② 배송 진행중</h4>
      <div class="hint" style="margin-bottom:8px;">목적지: ${tp.destination} · 배송기사: ${tp.driverName}</div>
      <div class="dstepper-slot">${renderDeliveryStepperHTML(r)}</div>
      <div class="hint transit-remain" style="margin:8px 0;">다음 위치까지 약 ${tp.remainSec}초 남음</div>
      <button class="btn btn-sm" id="km-arrive-${r.id}">도착 확인</button>
    </div>`);
    card.querySelector(`#km-arrive-${r.id}`).addEventListener('click', () => { Store.forceArrive(r.id); render(); });
    journeyBox.appendChild(card);
  } else if (r.stage === '시공중') {
    // 지정업체와의 시공 진행·완료 확인은 카마스터-업체 간 별개 거래다 — 고객·신차 케어 서비스와는
    // 무관하며, 이 앱은 그 소통 자체를 중개하지 않는다. 카마스터가 오프라인으로 확인한 뒤 대리로
    // 다음 단계(오너에게 재배송)를 직접 시작한다.
    const card = el(`<div class="admin-controls">
      <h4>② 지정업체에서 작업 중</h4>
      <div class="hint" style="margin-bottom:8px;">차량이 ${r.karmasterShopName || '지정업체'}에 도착했습니다. 업체와 직접 소통해 시공완료를 확인한 뒤 아래 버튼으로 재배송을 시작해 주세요 — 고객에게는 이 진행상황이 어느 업체인지 노출되지 않습니다.</div>
      <button class="btn btn-primary btn-sm" id="km-shop-done-${r.id}">시공완료 확인 →</button>
    </div>`);
    card.querySelector(`#km-shop-done-${r.id}`).addEventListener('click', () => { Store.confirmKarmasterShopDone(r.id); render(); });
    journeyBox.appendChild(card);
  } else if (r.stage === '수령확인대기') {
    journeyBox.appendChild(el(`<div class="admin-controls"><h4>② 차량 도착 — 오너 확인 대기중</h4>
      <div class="hint">차량이 도착했습니다. 오너가 확인하면 신차인도서비스가 종료됩니다.</div>
    </div>`));
  } else if (r.stage === '인도완료') {
    journeyBox.appendChild(el(`<div class="admin-controls"><h4>신차인도서비스 완료</h4>
      <div class="hint">오너가 차량 수령을 확인했습니다. 이 건에 대한 카마스터의 역할은 여기서 끝납니다.</div>
      <span class="badge ${r.karmasterRated ? 'done' : 'wait'}">${r.karmasterRated ? '고객 평가 완료' : '고객 평가 대기중'}</span>
    </div>`));
  }

  // ③ 메시지 (신차인도서비스 종료 후에도 일반 고객 응대 채널로 계속 사용 가능)
  wrap.querySelector('#section-message').appendChild(renderMessageCard(r));

  return wrap;
}

// 메시지 스레드 — 선택된 고객 1명분만 표시
let msgDrafts = {};
function renderMessageCard(r) {
  const msgs = r.messages || [];
  const card = el(`<div class="admin-controls">
    <h4>메시지</h4>
    <div class="msg-thread" id="msg-thread-${r.id}"></div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <input id="msg-input-${r.id}" type="text" placeholder="답장을 입력하세요">
      <button class="btn btn-sm" id="msg-send-${r.id}" style="width:auto;padding:8px 16px;">보내기</button>
    </div>
  </div>`);
  const thread = card.querySelector(`#msg-thread-${r.id}`);
  if (msgs.length === 0) {
    thread.appendChild(el(`<div class="hint">아직 주고받은 메시지가 없습니다.</div>`));
  } else {
    msgs.forEach(m => {
      const mine = m.from === 'karmaster';
      thread.appendChild(el(`<div class="msg-bubble ${mine ? 'mine' : 'theirs'}"><div class="msg-meta">${mine ? '나' : r.customer.name} · ${fmtTime(m.t)}</div><div>${m.text}</div></div>`));
    });
  }
  const d = msgDrafts[r.id] || (msgDrafts[r.id] = { text: '' });
  const input = card.querySelector(`#msg-input-${r.id}`);
  input.value = d.text;
  input.addEventListener('input', () => { d.text = input.value; });
  card.querySelector(`#msg-send-${r.id}`).addEventListener('click', () => {
    if (!input.value.trim()) return;
    Store.sendMessage(r.id, 'karmaster', input.value);
    delete msgDrafts[r.id];
    render();
  });
  return card;
}

Store.onChange(() => { render(); });

// 전체 재렌더 없이 스텝 인디케이터/잔여시간만 0.3초마다 직접 갱신 (입력 폼에 영향 없음)
setInterval(() => {
  document.querySelectorAll('[data-rid]').forEach(card => {
    const id = card.getAttribute('data-rid');
    const r = Store.getReservation(id);
    if (!r || !r.transit || !r.transit.active) return;
    const tp = transitProgress(r);
    const remainEl = card.querySelector('.transit-remain');
    const stepSlot = card.querySelector('.dstepper-slot');
    if (remainEl) remainEl.textContent = `다음 위치까지 약 ${tp.remainSec}초 남음`;
    if (stepSlot) stepSlot.innerHTML = renderDeliveryStepperHTML(r);
  });
}, 300);

render();
