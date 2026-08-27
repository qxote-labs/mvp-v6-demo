/* karmaster.js (v6.2) — 계약은 반드시 고객이 시작한다. 이미 오프라인에서 체결된 계약의 내용(차량정보·
 * 계약일자·고객정보)을 고객이 앱에 등록하면, 등록된 카마스터라면 별도 코드 확인 없이 담당 목록에서 그
 * 내용을 검토하고 승인하는 것으로 연결된다 — 화면에 뜬 내용이 실제 계약서와 맞는지 눈으로 확인하는 게
 * 검증 수단이다. 아직 미등록인 카마스터는 고객에게 직접 전달받은 조회번호로 찾아 가입과 동시에 승인한다.
 * 카마스터의 역할은 출고 요청과 배송 모니터링까지이며, 오너가 차량 수령을 확인하는 순간 끝난다 —
 * 출고 후 시공이 예정된 건이라도, 그 시공(신차 케어 서비스)은 고객·시공사 간 별개의 계약이라 카마스터는
 * 관여하지 않는다. */

let loggedInId = sessionStorage.getItem('v6_km_id') || null;
let selectedId = sessionStorage.getItem('v6_km_sel') || null;
let kmSearchQuery = '';
let kmNewContractDraft = { name: '', phone: '', carModel: '', carBrand: '', contractNumber: '', destinationType: null };
let newPasswordNotice = null; // 정식 가입 직후 1회 안내할 로그인 비밀번호 — 배너를 닫거나 로그아웃하면 지운다
// 비가입자(미등록 카마스터) 흐름 상태 — 정식 로그인(loggedInId)과 완전히 별개다.
let unregisteredMode = null; // null | 'login' | 'recover'
let unregisteredReservationId = null; // 본인확인이 끝나 지금 보고 있는 예약 1건 — 있으면 그 예약 화면만 보여준다
let unregisteredRegisterDismissed = false; // "정식 가입하시겠어요?" 배너를 이번 조회에서 닫았는지

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
    if (unregisteredReservationId) root.appendChild(renderUnregisteredReservationView());
    else if (unregisteredMode === 'recover') root.appendChild(renderUnregisteredRecover());
    else if (unregisteredMode === 'login') root.appendChild(renderUnregisteredLogin());
    else root.appendChild(renderLogin());
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

// 카마스터는 이 앱에서 유일하게 가입이 강제되지 않는 역할이라(user-account-role-model-spec.md), 전화
// 번호만 알면 누구나 남의 계정에 들어갈 수 있다는 보안 허점이 있었다. 온보딩 시점에 확인코드(조회번호로
// 쓰였던 그 값)를 그대로 로그인 비밀번호로 승격시켜, 이제부터는 전화번호+비밀번호 조합이 실제 인증
// 수단이 되게 했다. 테스트 편의를 위한 "빠른 로그인" 드롭다운은 지금처럼 비밀번호 없이 그대로 둔다 —
// 데모/테스트 전용 우회 경로라는 성격 자체가 바뀌지 않았고, 기존 Playwright 테스트들이 이 경로에 의존한다.
function renderLogin() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">카마스터 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 연락처와 비밀번호로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <input id="login-pw" type="password" placeholder="비밀번호" style="margin-bottom:8px;" autocomplete="off">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleUnregisteredLogin()">비가입자이신가요? 계약 확인하기</button>
    </div>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:11.5px;color:#888;">데모 계정으로 빠른 로그인 (비밀번호 불필요)</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getKarmasters().map(k => `<option value="${k.id}">${k.name} · ${k.phone}</option>`).join('')}
      </select>
      <button class="btn btn-sample" id="quick-unregistered-demo" type="button" style="margin-top:10px;">🧪 예시: 미가입 카마스터 시나리오 보기</button>
      <div class="hint" style="margin-top:4px;">실제로는 고객이 전화번호·계약번호·조회번호를 카마스터에게 직접 전달해야 하는데, 그걸 대신 재현해 보여줍니다.</div>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), pwEl = wrap.querySelector('#login-pw'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  wrap.querySelector('#quick-unregistered-demo').addEventListener('click', () => {
    const demo = Store.getOrCreateUnregisteredDemo();
    const found = Store.getReservationByPhoneContractCode(demo);
    unregisteredLoginDraft = { phone: demo.phone, contractNumber: demo.contractNumber, confirmCode: demo.confirmCode };
    if (found) {
      unregisteredReservationId = found.id;
      unregisteredRegisterDismissed = false;
    } else {
      unregisteredMode = 'login';
    }
    render();
  });
  submitBtn.addEventListener('click', () => {
    const km = Store.getKarmasterByPhone(phoneEl.value);
    if (!km) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    if (!km.pin || km.pin !== pwEl.value) { hintEl.textContent = '비밀번호가 일치하지 않습니다.'; return; }
    tryLogin(km.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function toggleUnregisteredLogin() { unregisteredMode = unregisteredMode === 'login' ? null : 'login'; unregisteredLoginDraft = { phone: '', contractNumber: '', confirmCode: '' }; render(); }

// 목적지 유형(destinationType) 선택 버튼 3개 — 카마스터 승인/온보딩 두 화면에서 공용으로 쓴다. 코드가
// 아이디의 앞부분(고정 접두어 바로 뒤)에 오도록 해서, 여러 예약 카드가 동시에 화면에 있을 때도
// `button[id^="km-dest-DEALERSHIP-"]`처럼 종류만으로 특정 버튼을 안정적으로 골라낼 수 있게 한다.
function destinationTypeButtonsHTML(idPrefix, suffix) {
  return DESTINATION_TYPE_OPTIONS.map(o => `<button class="btn btn-sm" id="${idPrefix}-${o.code}${suffix || ''}">${o.label}</button>`).join('');
}
function wireDestinationTypeButtons(container, idPrefix, suffix, onSelect) {
  DESTINATION_TYPE_OPTIONS.forEach(o => {
    container.querySelector(`#${idPrefix}-${o.code}${suffix || ''}`).addEventListener('click', () => onSelect(o.code));
  });
}

// 소속 그룹(Group) 다중 선택 체크박스 — 카탈로그(Store.getGroups())에서 고르며, 승인 없이 즉시 반영된다
// (user-account-role-model-spec.md 1.3절). 카마스터 온보딩 화면에서만 쓴다.
function groupCheckboxesHTML(idPrefix, selectedIds) {
  const groups = Store.getGroups();
  if (!groups.length) return '<div class="hint">등록된 그룹이 없습니다.</div>';
  return groups.map(g => `<label style="display:inline-flex;align-items:center;gap:4px;margin:0 12px 6px 0;font-weight:400;font-size:12.5px;"><input type="checkbox" id="${idPrefix}-${g.groupId}" ${(selectedIds || []).includes(g.groupId) ? 'checked' : ''}>${g.name}</label>`).join('');
}
function wireGroupCheckboxes(container, idPrefix, draft) {
  Store.getGroups().forEach(g => {
    const cb = container.querySelector(`#${idPrefix}-${g.groupId}`);
    if (!cb) return;
    cb.addEventListener('change', () => {
      if (cb.checked) { if (!draft.groupIds.includes(g.groupId)) draft.groupIds.push(g.groupId); }
      else draft.groupIds = draft.groupIds.filter(id => id !== g.groupId);
    });
  });
}

// ===================== 비가입자 로그인 (가입 없이 예약 1건만 확인·처리) =====================
// 카마스터는 고객과 달리 가입이 강제되지 않는다(user-account-role-model-spec.md). 계약이 등록되면
// 카마스터 전화번호·계약번호·조회번호(확인코드) 세 가지가 함께 전달되고, 이 조합은 "그 예약의
// 신차인도서비스가 완료될 때까지" 임시 비밀번호처럼 쓰인다 — 정식 가입(비밀번호 발급)과는 별개다.
// 승인까지 마친 뒤에도 가입은 강제하지 않고, 계속 활동할 뜻이 있는지 별도로 물어본다. 조회번호를
// 잃어버렸다면 계약서 정보(계약번호+계약자명)로 다시 확인할 수 있는 복구 경로도 남겨둔다.
let unregisteredLoginDraft = { phone: '', contractNumber: '', confirmCode: '' };
let unregisteredRecoverDraft = { contractNumber: '', customerName: '', carBrand: '' };
let unregisteredApproveDraft = { name: '', groupIds: [], destinationType: null, consultMemo: '', shopName: '' };

function renderUnregisteredLogin() {
  const d = unregisteredLoginDraft;
  const wrap = el(`<div style="max-width:440px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">비가입자 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">아직 가입하지 않았어도, 계약 등록 시 함께 전달된 전화번호·제조사 계약번호·조회번호로 그 계약 하나를 확인·처리할 수 있습니다. 이 조합은 해당 계약의 신차인도서비스가 끝날 때까지 계속 쓸 수 있습니다.</div>
    <label style="text-align:left;">카마스터 전화번호</label>
    <input id="ul-phone" type="tel" placeholder="010-1234-5678" autocomplete="off">
    <label style="text-align:left;">제조사 계약번호</label>
    <input id="ul-contract-no" type="text" placeholder="계약서에 적힌 실제 계약번호" autocomplete="off">
    <label style="text-align:left;">조회번호</label>
    <input id="ul-code" type="text" maxlength="6" placeholder="예: 482913" autocomplete="off">
    <div class="hint" id="ul-hint" style="margin:8px 0;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="ul-submit">확인</button>
    <div class="btn-row" style="margin-top:10px;justify-content:center;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleUnregisteredRecover()">조회번호를 잊어버리셨나요? 계약번호·계약자명으로 찾기</button>
    </div>
    <div class="btn-row" style="margin-top:6px;justify-content:center;">
      <button class="btn btn-outline" style="width:auto;padding:8px 14px;" onclick="toggleUnregisteredLogin()">← 로그인 화면으로</button>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#ul-phone'), cnEl = wrap.querySelector('#ul-contract-no'), codeEl = wrap.querySelector('#ul-code'), hintEl = wrap.querySelector('#ul-hint'), submitBtn = wrap.querySelector('#ul-submit');
  phoneEl.value = d.phone; cnEl.value = d.contractNumber; codeEl.value = d.confirmCode;
  phoneEl.addEventListener('input', () => { d.phone = loginPhoneFormat(phoneEl.value); phoneEl.value = d.phone; hintEl.textContent = ''; });
  cnEl.addEventListener('input', () => { d.contractNumber = cnEl.value; hintEl.textContent = ''; });
  codeEl.addEventListener('input', () => { d.confirmCode = codeEl.value.replace(/[^0-9]/g, '').slice(0, 6); codeEl.value = d.confirmCode; hintEl.textContent = ''; });
  submitBtn.addEventListener('click', () => {
    const found = Store.getReservationByPhoneContractCode({ phone: d.phone, contractNumber: d.contractNumber, confirmCode: d.confirmCode });
    if (!found) { hintEl.textContent = '일치하는 계약을 찾을 수 없습니다. 전화번호·계약번호·조회번호를 다시 확인해주세요.'; return; }
    unregisteredReservationId = found.id;
    unregisteredRegisterDismissed = false;
    render();
  });
  return wrap;
}
function toggleUnregisteredRecover() { unregisteredMode = 'recover'; unregisteredRecoverDraft = { contractNumber: '', customerName: '', carBrand: '' }; render(); }
function renderUnregisteredRecover() {
  const d = unregisteredRecoverDraft;
  const found = (d.contractNumber.trim() && d.customerName.trim()) ? Store.getReservationByContractInfo({ contractNumber: d.contractNumber, customerName: d.customerName, carBrand: d.carBrand }) : null;
  const wrap = el(`<div style="max-width:440px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">조회번호 다시 확인하기</h2>
    <div class="sub" style="margin-bottom:20px;">계약서상의 정보로 조회번호를 다시 확인할 수 있습니다.</div>
    <label style="text-align:left;">제조사 계약번호</label>
    <input id="ur-contract-no" type="text" placeholder="계약서에 적힌 실제 계약번호" autocomplete="off">
    <label style="text-align:left;">계약자명</label>
    <input id="ur-customer-name" type="text" placeholder="계약서상의 고객 이름" autocomplete="off">
    <label style="text-align:left;">제조사 (선택 — 추가로 한 번 더 확인)</label>
    <select id="ur-car-brand">
      <option value="">선택 안 함</option>
      <option value="현대">현대</option>
      <option value="기아">기아</option>
      <option value="기타">기타</option>
    </select>
    <div class="hint" id="ur-hint" style="margin:8px 0;min-height:16px;"></div>
    <div class="btn-row" style="margin-top:10px;justify-content:center;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="setUnregisteredMode('login')">← 비가입자 로그인으로</button>
    </div>
  </div>`);
  const cnEl = wrap.querySelector('#ur-contract-no'), nameEl = wrap.querySelector('#ur-customer-name'), brandEl = wrap.querySelector('#ur-car-brand'), hintEl = wrap.querySelector('#ur-hint');
  cnEl.value = d.contractNumber; nameEl.value = d.customerName; brandEl.value = d.carBrand;
  cnEl.addEventListener('input', () => { d.contractNumber = cnEl.value; render(); });
  nameEl.addEventListener('input', () => { d.customerName = nameEl.value; render(); });
  brandEl.addEventListener('change', () => { d.carBrand = brandEl.value; render(); });
  if (d.contractNumber.trim() && d.customerName.trim()) {
    hintEl.innerHTML = found
      ? `조회번호는 <b>${found.confirmCode}</b>입니다. 비가입자 로그인 화면에서 전화번호·계약번호와 함께 이 번호를 입력해 주세요.`
      : '일치하는 계약을 찾을 수 없습니다. 계약번호·계약자명을 다시 확인해주세요.';
  }
  return wrap;
}
function setUnregisteredMode(mode) { unregisteredMode = mode; render(); }

function renderUnregisteredReservationView() {
  const r = Store.getReservation(unregisteredReservationId);
  if (!r) { unregisteredReservationId = null; return renderUnregisteredLogin(); }
  const wrap = el(`<div style="max-width:640px;margin:0 auto;">
    <div class="btn-row" style="justify-content:flex-end;margin-bottom:16px;">
      <button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="exitUnregisteredSession()">나가기</button>
    </div>
    <div class="hint" style="margin-bottom:14px;">비가입자로 이 계약 1건만 확인·처리하고 있습니다. 전화번호·계약번호·조회번호로 다시 들어올 수 있으며, 신차인도서비스가 완료되면 더는 쓸 수 없습니다.</div>
    <div id="ur-register-slot"></div>
    <div id="ur-detail-slot"></div>
  </div>`);

  if (r.stage === '고객요청') {
    wrap.querySelector('#ur-detail-slot').appendChild(renderUnregisteredApproveForm(r));
  } else {
    const km = Store.getKarmaster(r.karmasterId);
    if (km && !km.pin) wrap.querySelector('#ur-register-slot').appendChild(renderRegisterOfferBanner(km));
    wrap.querySelector('#ur-detail-slot').appendChild(renderCustomerDetail(r));
  }
  return wrap;
}
function exitUnregisteredSession() { unregisteredReservationId = null; unregisteredMode = null; unregisteredRegisterDismissed = false; render(); }

function renderUnregisteredApproveForm(r) {
  const d = unregisteredApproveDraft;
  const form = el(`<div class="admin-controls">
    <h4>등록된 계약 내용 (고객 입력)</h4>
    ${renderPreReleaseStepperHTML(r)}
    <div class="summary-line"><span>고객</span><span>${r.customer.name} (${r.customer.phone})</span></div>
    <div class="summary-line"><span>제조사 계약번호</span><span>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</span></div>
    <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
    <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>

    <label style="margin-top:16px;">본인 이름</label>
    <input id="ua-name" type="text" placeholder="본인 이름" autocomplete="off">
    <label>소속 그룹 (복수 선택 가능, 승인 불필요)</label>
    <div>${groupCheckboxesHTML('ua-grp', d.groupIds)}</div>
    <label style="margin-top:8px;">목적지 유형</label>
    <div class="btn-row" style="margin-top:0;">${destinationTypeButtonsHTML('ua-dest')}</div>
    <div class="hint" id="ua-need-status"></div>
    <div id="ua-shop-wrap">
      <label>지정업체명 (선택 — 제휴 시공소 경유 시, 카마스터와 그 업체 간 별개 거래이며 고객에게는 노출되지 않습니다)</label>
      <input id="ua-shop" type="text" placeholder="예: OO오토라운지" autocomplete="off">
    </div>
    <label>상담 메모 (선택)</label>
    <textarea id="ua-memo" rows="3"></textarea>
    <button class="btn btn-primary btn-sm" id="ua-submit" style="margin-top:10px;" disabled>계약 승인</button>
  </div>`);
  const nameEl = form.querySelector('#ua-name');
  const memoEl = form.querySelector('#ua-memo'), shopEl = form.querySelector('#ua-shop'), shopWrap = form.querySelector('#ua-shop-wrap');
  const statusEl = form.querySelector('#ua-need-status'), submitBtn = form.querySelector('#ua-submit');
  nameEl.value = d.name; memoEl.value = d.consultMemo; shopEl.value = d.shopName;
  function refreshStatus() {
    statusEl.textContent = d.destinationType ? `${destinationTypeLabel(d.destinationType)}로 합의됨` : '선택되지 않음';
    shopWrap.style.display = d.destinationType === 'AFFILIATED_SHOP' ? '' : 'none';
  }
  function validate() { submitBtn.disabled = !(d.name.trim().length >= 2 && d.destinationType !== null); }
  refreshStatus(); validate();
  nameEl.addEventListener('input', () => { d.name = nameEl.value; validate(); });
  memoEl.addEventListener('input', () => { d.consultMemo = memoEl.value; });
  shopEl.addEventListener('input', () => { d.shopName = shopEl.value; });
  wireGroupCheckboxes(form, 'ua-grp', d);
  wireDestinationTypeButtons(form, 'ua-dest', '', (code) => { d.destinationType = code; refreshStatus(); validate(); });
  submitBtn.addEventListener('click', () => {
    Store.approveContractAsUnregistered(r.id, {
      name: d.name.trim(), groupIds: d.groupIds,
      destinationType: d.destinationType, consultMemo: d.consultMemo, karmasterShopName: d.shopName.trim(),
    });
    unregisteredApproveDraft = { name: '', groupIds: [], destinationType: null, consultMemo: '', shopName: '' };
    unregisteredRegisterDismissed = false;
    render();
  });
  return form;
}

// 계약 승인이 끝난 뒤에도 가입은 강제하지 않는다 — 계속 카마스터로 활동할 뜻이 있을 때만, 별도로
// 물어봐서 정식 비밀번호를 발급한다(조회번호와는 무관한 새 값). 가입하면 그 순간부터는 이 예약을 포함한
// 모든 계약을 전화번호+비밀번호로 로그인하는 일반 대시보드에서 관리한다.
function renderRegisterOfferBanner(km) {
  if (unregisteredRegisterDismissed) return el(`<div></div>`);
  const box = el(`<div class="msg-box" style="margin-bottom:14px;">
    <b>앞으로도 카마스터로 계속 활동하실 계획이신가요?</b><br>
    정식 가입하면 전화번호+비밀번호로 언제든 로그인해 모든 계약을 한 화면에서 관리할 수 있습니다. 원치 않으시면 지금처럼 전화번호·계약번호·조회번호로 이 계약만 계속 확인하셔도 됩니다.
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-primary btn-sm" id="ur-register-btn">가입하기</button>
      <button class="btn btn-outline btn-sm" id="ur-register-later">나중에</button>
    </div>
  </div>`);
  box.querySelector('#ur-register-btn').addEventListener('click', () => {
    const password = Store.registerKarmasterPassword(km.id);
    loggedInId = km.id;
    sessionStorage.setItem('v6_km_id', loggedInId);
    newPasswordNotice = password;
    unregisteredReservationId = null; unregisteredMode = null; unregisteredRegisterDismissed = false;
    render();
  });
  box.querySelector('#ur-register-later').addEventListener('click', () => { unregisteredRegisterDismissed = true; render(); });
  return box;
}
function tryLogin(id) {
  loggedInId = id; sessionStorage.setItem('v6_km_id', id);
  const km = Store.getKarmaster(id);
  if (km) Store.touchUserRole(km.phone, km.name, 'karmaster'); // 통합 User에 karmaster 역할 속성 부착(상호주의 원칙, 겸임 시연용)
  render();
}
function logout() { loggedInId = null; selectedId = null; nicknameDraft = null; newPasswordNotice = null; unregisteredMode = null; unregisteredReservationId = null; unregisteredRegisterDismissed = false; sessionStorage.removeItem('v6_km_id'); sessionStorage.removeItem('v6_km_sel'); render(); }
function dismissPasswordNotice() { newPasswordNotice = null; render(); }
function selectReservation(id) {
  selectedId = id;
  sessionStorage.setItem('v6_km_sel', id);
  Store.markMessagesRead(id);
  render();
}

function stageStepLabel(r) {
  const map = {
    '고객요청': '① 승인 필요',
    '계약등록': '② 고객 확인 대기',
    '계약확정': Store.canRequestRelease(r) ? '③ 출고 요청 가능' : '③ 고객 출고요청 대기',
    IN_TRANSIT: r.transitStage === 'TO_SHOP' ? '④ 지정업체行 이동중 (IN_TRANSIT)' : '④ 탁송중 (IN_TRANSIT)',
    CUSTOMIZING: '④ 지정업체 시공중 (카마스터 확인 대기)',
    DELIVERED: '⑤ 고객 도착 확인 대기 (DELIVERED)',
    CONFIRMED: '완료 (신차인도서비스 종료)',
    EXCEPTION: '⚠ 배송 지연/예외 상태',
  };
  return map[r.stage] || r.stage;
}

// ===================== 새 고객 계약 대리 등록 =====================
// 관리자의 "계약 대리 등록"(admin.js)과 같은 Store.createContractRecordDirect를 그대로 쓰지만, 담당
// 카마스터를 고르는 절차가 없다 — 이 화면을 보고 있는 카마스터 본인으로 고정된다. 본인이 이미 검토를
// 마치고 입력하는 것이므로 고객의 최초 입력 단계만 건너뛸 뿐, 뒤이은 "고객 확인"은 그대로 남는다
// (createContractRecordDirect가 만드는 예약은 이미 '계약등록' 단계에서 시작 — 카마스터 승인 단계 자체가
// 없다). 연락처를 입력하는 즉시 이 번호로 예약 이력이 있는 재방문 고객인지, 처음 온 고객인지 실시간으로
// 알려준다.
function renderKmNewContractForm(km) {
  const d = kmNewContractDraft;
  const wrap = el(`<div>
    <div class="hint" style="margin-bottom:10px;">고객이 아직 앱을 열기 전이더라도, 오프라인에서 체결한 계약 내용을 카마스터가 대신 입력해둘 수 있습니다. 등록 즉시 아래 연락처로 고객이 확인할 수 있는 상태가 됩니다.</div>
    <label>고객 실명</label><input id="km-nc-name" type="text" placeholder="홍길동" autocomplete="off">
    <label>고객 연락처</label><input id="km-nc-phone" type="tel" placeholder="010-1234-5678" autocomplete="off">
    <div class="hint" id="km-nc-phone-status"></div>
    <label>확정 차종</label><input id="km-nc-car" type="text" placeholder="예: 쏘렌토 하이브리드" autocomplete="off">
    <label>제조사</label>
    <select id="km-nc-brand">
      <option value="">선택 안 함</option>
      <option value="현대">현대</option>
      <option value="기아">기아</option>
      <option value="기타">기타</option>
    </select>
    <label>제조사 계약번호</label><input id="km-nc-contract-no" type="text" placeholder="계약서에 적힌 실제 계약번호" autocomplete="off">
    <label style="margin-top:8px;">목적지 유형</label>
    <div class="btn-row" style="margin-top:0;">${destinationTypeButtonsHTML('km-nc-dest')}</div>
    <div class="hint" id="km-nc-dest-status"></div>
    <button class="btn btn-primary btn-auto" id="km-nc-submit" style="margin-top:14px;" disabled>계약 등록하기</button>
  </div>`);
  const nameEl = wrap.querySelector('#km-nc-name'), phoneEl = wrap.querySelector('#km-nc-phone'), carEl = wrap.querySelector('#km-nc-car');
  const brandEl = wrap.querySelector('#km-nc-brand'), contractNoEl = wrap.querySelector('#km-nc-contract-no');
  const phoneStatusEl = wrap.querySelector('#km-nc-phone-status'), destStatusEl = wrap.querySelector('#km-nc-dest-status'), submitBtn = wrap.querySelector('#km-nc-submit');
  nameEl.value = d.name; phoneEl.value = d.phone; carEl.value = d.carModel; brandEl.value = d.carBrand; contractNoEl.value = d.contractNumber;
  function refreshPhoneStatus() {
    const prior = d.phone.trim() ? Store.getReservationsByPhone(d.phone) : [];
    if (!d.phone.trim()) { phoneStatusEl.textContent = ''; return; }
    phoneStatusEl.textContent = prior.length > 0
      ? `기존 고객입니다 — 이전 계약 이력 ${prior.length}건`
      : '처음 등록하는 신규 고객입니다.';
  }
  function refreshDestStatus() { destStatusEl.textContent = d.destinationType ? destinationTypeLabel(d.destinationType) : '선택되지 않음'; }
  function validate() { submitBtn.disabled = !(d.name.trim().length >= 2 && /^010-?\d{3,4}-?\d{4}$/.test(d.phone) && d.carModel.trim().length >= 2 && d.carBrand && d.contractNumber.trim() && d.destinationType !== null); }
  refreshPhoneStatus(); refreshDestStatus(); validate();
  nameEl.addEventListener('input', () => { d.name = nameEl.value; validate(); });
  phoneEl.addEventListener('input', () => { d.phone = phoneEl.value; refreshPhoneStatus(); validate(); });
  carEl.addEventListener('input', () => { d.carModel = carEl.value; validate(); });
  brandEl.addEventListener('change', () => { d.carBrand = brandEl.value; validate(); });
  contractNoEl.addEventListener('input', () => { d.contractNumber = contractNoEl.value; validate(); });
  wireDestinationTypeButtons(wrap, 'km-nc-dest', '', (code) => { d.destinationType = code; refreshDestStatus(); validate(); });
  submitBtn.addEventListener('click', () => {
    const r = Store.createContractRecordDirect({
      karmasterId: km.id,
      customer: { name: d.name.trim(), phone: d.phone, nickname: '' },
      carModel: d.carModel.trim(), carBrand: d.carBrand, contractNumber: d.contractNumber.trim(), destinationType: d.destinationType,
    });
    kmNewContractDraft = { name: '', phone: '', carModel: '', carBrand: '', contractNumber: '', destinationType: null };
    selectReservation(r.id);
  });
  return wrap;
}

// ===================== 표시 이름 설정 (닉네임/실명) — user-account-role-model-spec.md 3장/4.2/5장 =====================
// 현대/기아 소속(brandAffiliationFor === 'hyundai_kia')이면 표시 방식 토글 자체를 숨기고 닉네임으로
// 강제한다 — 제조사 정책상 그 브랜드를 취급하는 카마스터의 실명이 고객 화면에 노출되면 안 되기 때문이다.
let nicknameDraft = null; // { value } — 카마스터가 바뀌면(로그아웃 등) null로 리셋해 이전 입력이 새지 않게 한다
function renderDisplayNameSettings(km) {
  if (nicknameDraft === null) nicknameDraft = { value: km.nickname || '' };
  const d = nicknameDraft;
  const forced = brandAffiliationFor(km.id) === 'hyundai_kia';
  const box = el(`<div class="admin-controls" style="margin-bottom:16px;">
    <h4>표시 이름 설정</h4>
    <div class="hint" style="margin-bottom:8px;">${forced
      ? '현대/기아 브랜드를 취급한 이력이 있어, 제조사 정책에 따라 고객 화면에는 실명 대신 닉네임만 표시됩니다(변경 불가).'
      : '고객 화면에 닉네임 또는 실명 중 무엇을 보여줄지 직접 선택할 수 있습니다.'}</div>
    <label>닉네임</label>
    <input id="km-nick-input" type="text" placeholder="닉네임을 입력하세요" autocomplete="off">
    <div class="hint" id="km-nick-status"></div>
    <div id="km-nick-suggestions"></div>
    <button class="btn btn-sm" id="km-nick-save" style="margin-top:8px;" disabled>닉네임 저장</button>
    ${!forced ? `
    <label style="margin-top:14px;">표시 방식</label>
    <div class="btn-row" style="margin-top:0;">
      <button class="btn btn-sm ${km.nameDisplayMode !== 'real_name' ? 'btn-primary' : ''}" id="km-dispmode-nickname">닉네임 표시</button>
      <button class="btn btn-sm ${km.nameDisplayMode === 'real_name' ? 'btn-primary' : ''}" id="km-dispmode-real">실명 표시</button>
    </div>` : ''}
    <div class="hint" style="margin-top:8px;">현재 고객 화면에 보이는 이름: <b>${karmasterDisplayName(km)}</b></div>
  </div>`);

  const nickInput = box.querySelector('#km-nick-input'), statusEl = box.querySelector('#km-nick-status');
  const suggBox = box.querySelector('#km-nick-suggestions'), saveBtn = box.querySelector('#km-nick-save');
  nickInput.value = d.value;
  let debounceTimer = null;
  function checkAvailability() {
    const val = nickInput.value.trim();
    suggBox.innerHTML = '';
    if (!val) { statusEl.textContent = ''; saveBtn.disabled = true; return; }
    if (val === (km.nickname || '')) { statusEl.textContent = '현재 사용 중인 닉네임입니다.'; saveBtn.disabled = true; return; }
    if (Store.isKarmasterNicknameTaken(val, km.id)) {
      statusEl.textContent = '이미 사용 중인 닉네임입니다.';
      saveBtn.disabled = true;
      let n = 2;
      const candidates = [];
      while (candidates.length < 3 && n < 50) {
        const cand = `${val}${n}`;
        if (!Store.isKarmasterNicknameTaken(cand, km.id)) candidates.push(cand);
        n++;
      }
      candidates.forEach(c => {
        const btn = el(`<button class="btn btn-sm" style="margin:4px 6px 0 0;">${c}</button>`);
        btn.addEventListener('click', () => { nickInput.value = c; d.value = c; checkAvailability(); });
        suggBox.appendChild(btn);
      });
    } else {
      statusEl.textContent = '사용 가능한 닉네임입니다.';
      saveBtn.disabled = false;
    }
  }
  nickInput.addEventListener('input', () => {
    d.value = nickInput.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkAvailability, 300);
  });
  saveBtn.addEventListener('click', () => {
    Store.setKarmasterProfile(km.id, { nickname: nickInput.value.trim() });
    nicknameDraft = null;
    render();
  });
  if (!forced) {
    box.querySelector('#km-dispmode-nickname').addEventListener('click', () => { Store.setKarmasterProfile(km.id, { nameDisplayMode: 'nickname' }); render(); });
    box.querySelector('#km-dispmode-real').addEventListener('click', () => { Store.setKarmasterProfile(km.id, { nameDisplayMode: 'real_name' }); render(); });
  }
  return box;
}

function renderDashboard(km) {
  const list = Store.getReservationsByKarmaster(km.id);
  const approvalNeeded = list.filter(r => r.stage === '고객요청').length;
  const confirmWaiting = list.filter(r => r.stage === '계약등록').length;
  const releaseNeeded = list.filter(r => Store.canRequestRelease(r)).length;
  const unreadMsg = list.filter(r => r.karmasterUnread).length;
  const doneCount = list.filter(r => r.stage === 'CONFIRMED').length;

  const wrap = el(`<div>
    <div class="btn-row" style="justify-content:flex-end;margin-bottom:16px;">
      <button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="logout()">로그아웃</button>
    </div>
    ${newPasswordNotice ? `<div class="msg-box" style="margin-bottom:14px;">
      <b>로그인 비밀번호가 발급되었습니다: ${newPasswordNotice}</b><br>
      다음부터는 전화번호와 이 비밀번호로 로그인해 주세요. 잊지 않도록 꼭 기록해 두세요.
      <div class="btn-row" style="margin-top:8px;"><button class="btn btn-sm btn-outline" onclick="dismissPasswordNotice()">확인했습니다</button></div>
    </div>` : ''}
    <div class="kpi-row">
      <div class="kpi-box"><div class="v">${list.length}</div><div class="k">전체 담당 고객</div></div>
      <div class="kpi-box"><div class="v">${approvalNeeded}</div><div class="k">승인 필요</div></div>
      <div class="kpi-box"><div class="v">${confirmWaiting}</div><div class="k">고객 확인 대기</div></div>
      <div class="kpi-box"><div class="v">${releaseNeeded}</div><div class="k">출고 요청 가능</div></div>
      <div class="kpi-box"><div class="v">${unreadMsg}</div><div class="k">읽지 않은 메시지</div></div>
      <div class="kpi-box"><div class="v">${doneCount}</div><div class="k">인도 완료</div></div>
    </div>
    <div class="split"><div class="side" id="km-list"></div><div class="main" id="km-detail"></div></div>
    <details style="margin-top:20px;">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;">+ 새 고객 계약 등록 (고객 대신 입력)</summary>
      <div id="km-newcontract-slot" style="margin-top:10px;"></div>
    </details>
    <details style="margin-top:12px;">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;">표시 이름 설정 (닉네임/실명)</summary>
      <div id="km-displayname-slot" style="margin-top:10px;"></div>
    </details>
  </div>`);

  wrap.querySelector('#km-newcontract-slot').appendChild(renderKmNewContractForm(km));
  wrap.querySelector('#km-displayname-slot').appendChild(renderDisplayNameSettings(km));

  const listBox = wrap.querySelector('#km-list');
  listBox.appendChild(el(`<h3>담당 고객 목록</h3>`));
  if (list.length === 0) {
    listBox.appendChild(el(`<div class="hint">아직 등록된 계약이 없습니다. 고객이 계약 체결 후 앱에 계약내역을 등록하면 여기 나타납니다.</div>`));
  } else {
    const searchBox = el(`<input id="km-search" type="text" placeholder="접수번호·제조사 계약번호·고객이름·연락처로 검색" style="margin-bottom:10px;" autocomplete="off">`);
    searchBox.value = kmSearchQuery;
    searchBox.addEventListener('input', () => { kmSearchQuery = searchBox.value; render(); });
    listBox.appendChild(searchBox);

    const q = kmSearchQuery.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    const filtered = !q ? list : list.filter(r =>
      r.id.toLowerCase().includes(q) ||
      (r.contractNumber || '').toLowerCase().includes(q) ||
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
  const d = approveDrafts[r.id] || (approveDrafts[r.id] = { destinationType: null, consultMemo: '', shopName: '' });
  const card = el(`<div>
    <h3>${r.customer.name} (${r.customer.nickname || '-'}) · ${r.id}</h3>
    <div class="hint" style="margin-bottom:16px;">연락처: ${r.customer.phone} — 고객이 직접 입력한 정보입니다.</div>
    ${renderPreReleaseStepperHTML(r)}
    <div class="admin-controls">
      <h4>고객이 등록한 계약 내용</h4>
      <div class="hint" style="margin-bottom:8px;">아래 내용이 실제로 체결하신 계약과 맞는지 확인한 뒤 승인해 주세요.</div>
      <div class="summary-line"><span>제조사 계약번호</span><span>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</span></div>
      <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>

      <label style="margin-top:16px;">목적지 유형</label>
      <div class="btn-row" style="margin-top:0;">${destinationTypeButtonsHTML('km-dest', '-' + r.id)}</div>
      <div class="hint" id="km-need-status-${r.id}"></div>
      <div id="km-shop-wrap-${r.id}">
        <label>지정업체명 (선택 — 제휴 시공소 경유 시, 카마스터와 그 업체 간 별개 거래이며 고객에게는 노출되지 않습니다)</label>
        <input id="km-shop-${r.id}" type="text" placeholder="예: OO오토라운지" autocomplete="off">
      </div>
      <label>상담 메모 (선택)</label>
      <textarea id="km-memo-${r.id}" rows="3" placeholder="예: 색상 변경 희망, 인도 희망일, 트레이드인 문의 등"></textarea>
      <button class="btn btn-primary btn-sm" id="km-fill-submit-${r.id}" style="margin-top:10px;" disabled>계약 내용 승인</button>
    </div>
    <div id="km-approve-message"></div>
  </div>`);
  card.querySelector('#km-approve-message').appendChild(renderMessageCard(r));

  const memoEl = card.querySelector(`#km-memo-${r.id}`), shopEl = card.querySelector(`#km-shop-${r.id}`), shopWrap = card.querySelector(`#km-shop-wrap-${r.id}`);
  const statusEl = card.querySelector(`#km-need-status-${r.id}`), submitBtn = card.querySelector(`#km-fill-submit-${r.id}`);
  memoEl.value = d.consultMemo; shopEl.value = d.shopName;

  function refreshStatus() {
    statusEl.textContent = d.destinationType ? `${destinationTypeLabel(d.destinationType)}로 합의됨` : '선택되지 않음';
    shopWrap.style.display = d.destinationType === 'AFFILIATED_SHOP' ? '' : 'none';
  }
  function validate() { submitBtn.disabled = d.destinationType === null; }
  refreshStatus(); validate();

  memoEl.addEventListener('input', () => { d.consultMemo = memoEl.value; });
  shopEl.addEventListener('input', () => { d.shopName = shopEl.value; });
  wireDestinationTypeButtons(card, 'km-dest', '-' + r.id, (code) => { d.destinationType = code; refreshStatus(); validate(); });
  submitBtn.addEventListener('click', () => {
    Store.fillContractDetails(r.id, { destinationType: d.destinationType, consultMemo: d.consultMemo, karmasterShopName: d.shopName.trim() });
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
    <div id="section-stepper">${renderPreReleaseStepperHTML(r)}${renderStatusStepperHTML(r)}</div>
    <div id="section-augmentation"></div>
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
    <div class="summary-line"><span>제조사 계약번호</span><span>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</span></div>
    <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
    <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>
    <div class="summary-line"><span>목적지 유형</span><span>${destinationTypeLabel(r.destinationType)}</span></div>
    ${hasCustomizing(r) && r.karmasterShopName ? `<div class="summary-line"><span>지정업체</span><span>${r.karmasterShopName} (고객 비노출)</span></div>` : ''}
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

  // ② 배송/인도 진행 현황 — 카마스터는 DELIVERED(오너 도착 확인)까지만 지켜본다.
  const journeyBox = wrap.querySelector('#section-journey');
  if (r.stage === 'IN_TRANSIT') {
    const tp = transitProgress(r);
    const legLabel = r.transitStage === 'TO_SHOP' ? `지정업체(${r.karmasterShopName || '미지정'})로 이동중` : '최종 목적지로 이동중';
    const card = el(`<div class="admin-controls" data-rid="${r.id}">
      <h4>② 배송 진행중 (IN_TRANSIT)</h4>
      <div class="hint" style="margin-bottom:8px;">${legLabel} · 목적지: ${tp.destination} · 배송기사: ${tp.driverName}</div>
      <div class="dstepper-slot">${renderDeliveryStepperHTML(r)}</div>
      <div class="hint transit-remain" style="margin:8px 0;">다음 위치까지 약 ${tp.remainSec}초 남음</div>
      <div class="btn-row" style="margin-top:0;">
        <button class="btn btn-sm" id="km-arrive-${r.id}">도착 확인</button>
        <button class="btn btn-outline btn-sm" id="km-exc-open-${r.id}">지연/예외 표시</button>
      </div>
      <div id="km-exc-form-${r.id}"></div>
    </div>`);
    card.querySelector(`#km-arrive-${r.id}`).addEventListener('click', () => { Store.forceArrive(r.id); render(); });
    card.querySelector(`#km-exc-open-${r.id}`).addEventListener('click', () => openExceptionBox(r.id));
    card.querySelector(`#km-exc-form-${r.id}`).appendChild(renderExceptionFormSlot(r.id));
    journeyBox.appendChild(card);
  } else if (r.stage === 'CUSTOMIZING') {
    // 지정업체와의 시공 진행·완료 확인은 카마스터-업체 간 별개 거래다 — 고객·신차 케어 서비스와는
    // 무관하며, 이 앱은 그 소통 자체를 중개하지 않는다. 카마스터가 오프라인으로 확인한 뒤 대리로
    // 다음 단계(오너에게 재배송)를 직접 시작한다.
    const card = el(`<div class="admin-controls">
      <h4>② 지정업체에서 작업 중 (CUSTOMIZING)</h4>
      <div class="hint" style="margin-bottom:8px;">차량이 ${r.karmasterShopName || '지정업체'}에 도착했습니다. 업체와 직접 소통해 시공완료를 확인한 뒤 아래 버튼으로 재배송을 시작해 주세요 — 고객에게는 이 진행상황이 어느 업체인지 노출되지 않습니다.</div>
      <div class="btn-row" style="margin-top:0;">
        <button class="btn btn-primary btn-sm" id="km-shop-done-${r.id}">시공완료 확인 →</button>
        <button class="btn btn-outline btn-sm" id="km-exc-open-${r.id}">지연/예외 표시</button>
      </div>
      <div id="km-exc-form-${r.id}"></div>
    </div>`);
    card.querySelector(`#km-shop-done-${r.id}`).addEventListener('click', () => { Store.confirmKarmasterShopDone(r.id); render(); });
    card.querySelector(`#km-exc-open-${r.id}`).addEventListener('click', () => openExceptionBox(r.id));
    card.querySelector(`#km-exc-form-${r.id}`).appendChild(renderExceptionFormSlot(r.id));
    journeyBox.appendChild(card);
    journeyBox.appendChild(renderPhotoPanel(r, 'customizingPhotos', '커스터마이징 현장 사진', Store.addCustomizingPhoto, Store.withdrawCustomizingPhoto));
  } else if (r.stage === 'DELIVERED') {
    const card = el(`<div class="admin-controls">
      <h4>② 차량 도착 — 확인 필요 (DELIVERED)</h4>
      <div class="hint" style="margin-bottom:6px;">고객 최종인수승인: <span class="badge ${r.isCustomerApproved ? 'done' : 'wait'}">${r.isCustomerApproved ? '완료' : '대기중'}</span></div>
      <div class="hint" style="margin-bottom:8px;">카마스터 개인수령확인: <span class="badge ${r.isManagerConfirmed ? 'done' : 'wait'}">${r.isManagerConfirmed ? '완료' : '대기중'}</span></div>
      ${r.isManagerConfirmed ? '<div class="hint">고객의 최종인수승인이 완료되면 신차인도서비스가 종료됩니다.</div>' : '<button class="btn btn-primary btn-sm" id="km-mgr-confirm-' + r.id + '">개인수령확인 처리</button>'}
    </div>`);
    const mgrBtn = card.querySelector(`#km-mgr-confirm-${r.id}`);
    if (mgrBtn) mgrBtn.addEventListener('click', () => { Store.confirmManagerReceipt(r.id); render(); });
    journeyBox.appendChild(card);
    journeyBox.appendChild(renderPhotoPanel(r, 'deliveryPhotos', '인수 완료 사진', Store.addDeliveryPhoto, Store.withdrawDeliveryPhoto));
  } else if (r.stage === 'CONFIRMED') {
    journeyBox.appendChild(el(`<div class="admin-controls"><h4>신차인도서비스 완료 (CONFIRMED)</h4>
      <div class="hint">오너가 차량 수령을 확인했습니다. 이 건에 대한 카마스터의 역할은 여기서 끝납니다.</div>
      <span class="badge ${r.karmasterRated ? 'done' : 'wait'}">${r.karmasterRated ? '고객 평가 완료' : '고객 평가 대기중'}</span>
    </div>`));
  } else if (r.stage === 'EXCEPTION') {
    const card = el(`<div class="admin-controls">
      <h4>⚠ 배송 지연/예외 상태 (EXCEPTION)</h4>
      <div class="msg-box" style="border-left-color:#c22;">전환 사유(내부 전용): ${r.exceptionReason || '(미입력)'}</div>
      <div class="hint">고객 화면에는 이 내용이 아니라, 위쪽 "배송 상세정보 입력" 패널에서 지연 사유를 골라 게시해야 노출됩니다.</div>
      <button class="btn btn-primary btn-sm" id="km-exc-clear-${r.id}" style="margin-top:8px;">정상 운행으로 복귀</button>
    </div>`);
    card.querySelector(`#km-exc-clear-${r.id}`).addEventListener('click', () => { Store.clearException(r.id); render(); });
    journeyBox.appendChild(card);
  }

  // Layer 2: 배송 보강 정보 입력 — 실제 배송이 진행되는 동안(IN_TRANSIT/CUSTOMIZING/DELIVERED/EXCEPTION)에만 노출
  if (['IN_TRANSIT', 'CUSTOMIZING', 'DELIVERED', 'EXCEPTION'].includes(r.stage)) {
    wrap.querySelector('#section-augmentation').appendChild(renderAugmentationPanel(r));
  }

  // ③ 메시지 (신차인도서비스 종료 후에도 일반 고객 응대 채널로 계속 사용 가능)
  wrap.querySelector('#section-message').appendChild(renderMessageCard(r));

  return wrap;
}

// ===================== Layer 2: 배송 보강 정보 입력 (매니저) =====================
// 타이핑 중에는 로컬 변수에만 담아두고(Store를 매 키 입력마다 건드리지 않음), "초안 저장"/"게시하기"
// 버튼을 눌렀을 때만 Store에 반영한다 — 검색창 등 기존 화면과 동일한 패턴이다.
let augmentDrafts = {};
function getAugmentDraft(r) {
  if (!augmentDrafts[r.id]) augmentDrafts[r.id] = Object.assign({}, Store.getAugmentation(r).draft);
  return augmentDrafts[r.id];
}
function renderAugmentationPanel(r) {
  const aug = Store.getAugmentation(r);
  const d = getAugmentDraft(r);
  const showCustomizing = r.stage === 'CUSTOMIZING' && hasCustomizing(r);
  const showException = r.stage === 'EXCEPTION';
  // 기사정보/ETA/위치코멘트는 "커스터마이징"이나 "예외" 같은 특정 단계 얘기가 아니라 이 예약의
  // 배송/진행 전반에 대한 보강 정보다 — 그래서 스텝 바로 밑, 카드 하나에 다 모아둔다. [게시하기]가
  // 정확히 이 카드 안의 내용 전부(공정현황·지연사유 포함)를 함께 게시한다는 게 한눈에 보이도록,
  // 필드와 저장/게시 버튼을 같은 카드 안에 둔다. 사진은 이 카드가 아니라 각 단계별 작업 카드
  // (renderCustomerDetail의 #section-journey) 쪽에 붙는다 — 게시 게이트 없이 즉시 반영되는 별개
  // 메커니즘이라, 초안·게시 흐름과 섞으면 오히려 헷갈린다.
  const detailsEl = el(`<details class="admin-controls" style="margin-top:0;">
    <summary style="cursor:pointer;font-weight:800;font-size:13px;">배송 상세정보 입력 (선택)</summary>
    <div style="margin-top:10px;">
      <div class="hint" style="margin-bottom:10px;">여기 입력한 내용은 초안 상태로만 남고, [게시하기]를 눌러야 고객 화면에 반영됩니다. 기사 정보·특이사항 메모는 게시 대상이 아니라 항상 내부 전용입니다.</div>
      <label>기사 성명 (내부 전용, 고객 비노출)</label>
      <input id="aug-driver-name-${r.id}" type="text" placeholder="예: 최기사" autocomplete="off">
      <label>기사 연락처 (내부 전용, 고객 비노출)</label>
      <input id="aug-driver-phone-${r.id}" type="tel" placeholder="010-0000-0000" autocomplete="off">
      <label style="margin-top:12px;">도착 예정 시각 (ETA)</label>
      <input id="aug-eta-${r.id}" type="datetime-local">
      <label>위치 보정 코멘트</label>
      <input id="aug-loc-${r.id}" type="text" placeholder="예: 현재 언양 휴게소 부근 통과" autocomplete="off">
      ${showCustomizing ? `
      <label style="margin-top:12px;">커스터마이징 공정 현황</label>
      <textarea id="aug-custprog-${r.id}" rows="2" placeholder="예: 1일차 틴팅 완료, 2일차 PPF 작업 중"></textarea>` : ''}
      ${showException ? `
      <label style="margin-top:12px;">지연 사유 (고객 노출용)</label>
      <select id="aug-delay-code-${r.id}">
        <option value="">선택 안 함</option>
        ${DELAY_REASON_OPTIONS.map(o => `<option value="${o.code}">${o.label}</option>`).join('')}
      </select>
      <textarea id="aug-delay-note-${r.id}" rows="2" placeholder="지연 사유 상세 메모 (고객 노출용 완곡 표현 권장)" style="margin-top:8px;"></textarea>` : ''}
      <label style="margin-top:12px;">특이사항 메모 (내부 전용, 고객 비노출)</label>
      <textarea id="aug-memo-${r.id}" rows="2" placeholder="CS 근거용 메모"></textarea>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn btn-outline btn-sm" id="aug-save-${r.id}">초안 저장</button>
        <button class="btn btn-primary btn-sm" id="aug-publish-${r.id}">게시하기</button>
      </div>
      <div class="hint" style="margin-top:6px;">${aug.published.publishedAt ? `마지막 게시: ${fmtTime(aug.published.publishedAt)}` : '아직 게시된 내용이 없습니다.'}</div>
    </div>
  </details>`);
  const nameEl = detailsEl.querySelector(`#aug-driver-name-${r.id}`), phoneEl = detailsEl.querySelector(`#aug-driver-phone-${r.id}`);
  const etaEl = detailsEl.querySelector(`#aug-eta-${r.id}`), locEl = detailsEl.querySelector(`#aug-loc-${r.id}`);
  const memoEl = detailsEl.querySelector(`#aug-memo-${r.id}`);
  nameEl.value = d.driverName; phoneEl.value = d.driverPhone; etaEl.value = d.eta; locEl.value = d.locationNote; memoEl.value = d.internalMemo;
  nameEl.addEventListener('input', () => { d.driverName = nameEl.value; });
  phoneEl.addEventListener('input', () => { d.driverPhone = phoneEl.value; });
  etaEl.addEventListener('input', () => { d.eta = etaEl.value; });
  locEl.addEventListener('input', () => { d.locationNote = locEl.value; });
  memoEl.addEventListener('input', () => { d.internalMemo = memoEl.value; });
  if (showCustomizing) {
    const custProgEl = detailsEl.querySelector(`#aug-custprog-${r.id}`);
    custProgEl.value = d.customizingProgress;
    custProgEl.addEventListener('input', () => { d.customizingProgress = custProgEl.value; });
  }
  if (showException) {
    const delayCodeEl = detailsEl.querySelector(`#aug-delay-code-${r.id}`), delayNoteEl = detailsEl.querySelector(`#aug-delay-note-${r.id}`);
    delayCodeEl.value = d.delayReasonCode; delayNoteEl.value = d.delayReasonNote;
    delayCodeEl.addEventListener('change', () => { d.delayReasonCode = delayCodeEl.value; });
    delayNoteEl.addEventListener('input', () => { d.delayReasonNote = delayNoteEl.value; });
  }
  detailsEl.querySelector(`#aug-save-${r.id}`).addEventListener('click', () => { Store.saveAugmentationDraft(r.id, d); render(); });
  detailsEl.querySelector(`#aug-publish-${r.id}`).addEventListener('click', () => { Store.publishAugmentation(r.id, d); render(); });

  return detailsEl;
}

// 인수 완료 사진 / 커스터마이징 현장 사진 공용 업로드 패널 — 텍스트 필드와 달리 게시 게이트 없이 업로드
// 즉시 게시되고, 회수(내리기)만 가능하다(service-spec.md 3.2절 예외 원칙).
function renderPhotoPanel(r, field, title, addFn, withdrawFn) {
  const aug = Store.getAugmentation(r);
  const photos = aug[field] || [];
  const live = photos.map((p, i) => ({ p, i })).filter(x => !x.p.withdrawn);
  const withdrawnCount = photos.length - live.length;
  const card = el(`<div class="admin-controls" style="margin-top:10px;">
    <h4>${title} (${live.length}/6, 업로드 즉시 게시)</h4>
    <div class="photo-row" style="margin-bottom:10px;">${live.length
      ? live.map(({ p, i }) => `<div style="flex:1;"><img src="${p.src}" style="width:100%;height:90px;object-fit:cover;border-radius:8px;border:1px solid #ddd;"><button class="btn btn-sm" data-widx="${i}" style="margin-top:4px;width:100%;">회수(내리기)</button></div>`).join('')
      : '<div class="hint">아직 업로드된 사진이 없습니다.</div>'}</div>
    <div class="btn-row" style="margin-top:0;">
      <button class="btn btn-sm" id="ph-sample-${field}-${r.id}" ${live.length >= 6 ? 'disabled' : ''}>샘플 이미지 추가</button>
      <label class="btn btn-sm" style="cursor:pointer;${live.length >= 6 ? 'opacity:0.4;pointer-events:none;' : ''}">파일 선택 업로드<input type="file" id="ph-file-${field}-${r.id}" accept="image/*" style="display:none;"></label>
    </div>
    ${withdrawnCount ? `<div class="hint" style="margin-top:8px;">회수된 사진 ${withdrawnCount}장 (고객 화면에는 노출되지 않음)</div>` : ''}
  </div>`);
  card.querySelectorAll('button[data-widx]').forEach(btn => {
    btn.addEventListener('click', () => { withdrawFn.call(Store, r.id, parseInt(btn.getAttribute('data-widx'), 10)); render(); });
  });
  card.querySelector(`#ph-sample-${field}-${r.id}`).addEventListener('click', () => {
    addFn.call(Store, r.id, generateSamplePhoto(live.length, `${title} ${live.length + 1}`), `${title} ${live.length + 1}`);
    render();
  });
  const fileInput = card.querySelector(`#ph-file-${field}-${r.id}`);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => { addFn.call(Store, r.id, reader.result, file.name); render(); };
    reader.readAsDataURL(file);
  });
  return card;
}

// 지연/예외(EXCEPTION) 전환 — 사유를 입력받는 간단한 인라인 폼. 평소엔 숨겨져 있다가 "지연/예외 표시"를
// 누르면 펼쳐진다.
let exceptionDrafts = {};
function openExceptionBox(id) { exceptionDrafts[id] = { open: true, reason: '' }; render(); }
function renderExceptionFormSlot(id) {
  const d = exceptionDrafts[id];
  if (!d || !d.open) return el(`<div></div>`);
  const box = el(`<div class="admin-controls" style="margin-top:8px;">
    <label>지연/예외 사유</label>
    <textarea id="exc-reason-${id}" rows="2" placeholder="예: 폭설로 고속도로 통제, 기사 배정 지연 등"></textarea>
    <div class="btn-row" style="margin-top:8px;">
      <button class="btn btn-danger btn-sm" id="exc-submit-${id}">지연/예외로 전환</button>
      <button class="btn btn-outline btn-sm" id="exc-cancel-${id}">취소</button>
    </div>
  </div>`);
  const reasonEl = box.querySelector(`#exc-reason-${id}`);
  reasonEl.value = d.reason;
  reasonEl.addEventListener('input', () => { d.reason = reasonEl.value; });
  box.querySelector(`#exc-submit-${id}`).addEventListener('click', () => { Store.markException(id, d.reason); delete exceptionDrafts[id]; render(); });
  box.querySelector(`#exc-cancel-${id}`).addEventListener('click', () => { delete exceptionDrafts[id]; render(); });
  return box;
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
