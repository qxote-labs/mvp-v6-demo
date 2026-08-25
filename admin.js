/* admin.js (v6) — admin.html(커뮤니티관리자)과 supervisor.html(슈퍼바이저) 둘이 이 스크립트 하나를
 * 공유한다. 두 역할은 성격이 다르다(user-account-role-model-spec.md 1.3/4.5/7장) — 커뮤니티관리자는
 * 배정된 Group 범위 안에서 일상적인 운영(승인·모니터링·대리처리)을 담당하는 "고객관리자"에 가깝고,
 * 슈퍼바이저는 전체 플랫폼에 대한 최종 권한(그룹 카탈로그 생성, 스코프 제한 없는 전체 조회/대리처리)을
 * 갖는 시스템 관리자다. 로그인 화면에 로드되기 전 각 HTML이 `window.ADMIN_MODE`를 'community' 또는
 * 'super'로 지정해두면, 이 스크립트가 그 값에 맞는 계정만 로그인을 허용하고 문구를 맞춘다 — 나머지
 * 로직(스코프 필터링, 탭 구성 등)은 두 화면이 동일하게 공유한다. */
const ADMIN_MODE = window.ADMIN_MODE || 'community';
let selectedId = sessionStorage.getItem('v6_admin_sel') || null;
let careSelectedId = sessionStorage.getItem('v6_admin_care_sel') || null;
let loggedInAdminId = sessionStorage.getItem('v6_admin_id') || null;
let adminTab = sessionStorage.getItem('v6_admin_tab') || 'delivery';
let showNewForm = false;
let showNewCareForm = false;
let adminFillDrafts = {};
let adminOnboardDrafts = {};

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function selectReservation(id) { selectedId = id; showNewForm = false; sessionStorage.setItem('v6_admin_sel', id); render(); }
function selectCareOrder(id) { careSelectedId = id; showNewCareForm = false; sessionStorage.setItem('v6_admin_care_sel', id); render(); }
function setAdminTab(tab) { adminTab = tab; sessionStorage.setItem('v6_admin_tab', tab); render(); }

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}
// 관리자는 셀프 온보딩 대상이 아니다(user-account-role-model-spec.md 1.6절) — 슈퍼바이저가 미리 계정을
// 만들어둔다는 전제라, 다른 역할처럼 "신규 등록하기"가 없다. 대신 등록된 슈퍼바이저/커뮤니티관리자
// 전화번호로 로그인한다.
function renderLogin() {
  const modeLabel = ADMIN_MODE === 'super' ? '슈퍼바이저' : '커뮤니티관리자';
  const candidates = Store.getAdmins().filter(a => a.adminScope === ADMIN_MODE);
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">${modeLabel} 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 ${modeLabel} 연락처로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <input type="password" placeholder="비밀번호 (추후 지원 예정)" disabled style="margin-bottom:8px;">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:11.5px;color:#888;">데모 계정으로 빠른 로그인</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${candidates.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
      </select>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  submitBtn.addEventListener('click', () => {
    const admin = Store.getAdminByPhone(phoneEl.value);
    if (!admin || admin.adminScope !== ADMIN_MODE) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    tryLogin(admin.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function tryLogin(id) { loggedInAdminId = id; sessionStorage.setItem('v6_admin_id', id); render(); }
function logout() { loggedInAdminId = null; sessionStorage.removeItem('v6_admin_id'); render(); }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInAdminId) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(renderLogin());
    return;
  }
  const admin = Store.getAdmin(loggedInAdminId);
  const isSuper = admin.adminScope === 'super';
  // 커뮤니티관리자는 배정된 Group에 속한 카마스터/시공업체가 처리하는 건만 본다(1.3절) — 슈퍼바이저는 전체.
  const list = Store.getReservations().filter(r => reservationInAdminScope(r, admin));
  const careList = Store.getCareOrders().filter(c => careOrderInAdminScope(c, admin));
  const pendingShopCount = Store.getShops().filter(s => s.verificationStatus === 'pending' && shopInAdminScope(s, admin)).length;
  const scopeLabel = isSuper ? '슈퍼바이저 · 전체 권한' : `커뮤니티관리자 · 담당 그룹: ${(admin.assignedGroupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '없음'}`;
  document.getElementById('header-right').textContent = `${admin.name} (${scopeLabel}) · 신차인도 ${list.length}건 · 신차 케어 ${careList.length}건`;

  const tabButtons = [
    ['delivery', '신차인도서비스'],
    ['care', '신차 케어 서비스'],
    ...(isSuper ? [['users', '통합 사용자']] : []), // 통합 사용자 탭은 전 그룹 고객정보가 섞여 보이므로 슈퍼바이저 전용
    ['shops', `업체 승인${pendingShopCount ? ` (${pendingShopCount})` : ''}`],
  ];
  root.appendChild(el(`<div class="btn-row" style="justify-content:space-between;margin-bottom:16px;">
    <div class="btn-row" style="margin:0;">
      ${tabButtons.map(([tab, label]) => `<button class="btn ${adminTab === tab ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="setAdminTab('${tab}')">${label}</button>`).join('')}
    </div>
    <button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="logout()">로그아웃</button>
  </div>`));

  const effectiveTab = (!isSuper && adminTab === 'users') ? 'delivery' : adminTab;
  const tabRenderers = { care: () => renderCareTab(careList), users: renderUsersTab, shops: () => renderShopApprovalTab(admin) };
  root.appendChild((tabRenderers[effectiveTab] || (() => renderDeliveryTab(list)))());
}

// ===================== 통합 사용자 탭 (user-account-role-model-spec.md 1.1/1.3/3장) =====================
// 전화번호를 공통 식별자로 삼아 역할 속성(roleAttributes)이 쌓이는 것을 보여준다 — "한 사람 = 하나의
// 계정 + 여러 역할 속성" 원칙과, 카마스터가 개인 차량을 구매하는 식의 겸임(상호주의) 사례를 확인하는
// 화면이다. 그룹(Group) 카탈로그 관리도 여기 함께 둔다 — 그룹 생성은 슈퍼바이저만 가능하다는 원칙에
// 따라(1.3절), 슈퍼바이저·커뮤니티관리자가 아직 분리되지 않은 이 데모에서는 관리자 계정이 슈퍼바이저를
// 겸한다. Shop 독립 레지스트리·실명 비노출 등 나머지 계정 모델 요소는 이번 범위 밖이다.
const ROLE_ATTR_LABELS = { customer: '구매자', karmaster: '카마스터', shop: '시공업체', driver: '배송기사' };
const GROUP_TYPE_LABELS = { region: '지역', community: '커뮤니티', industry: '산업군' };
function renderGroupCatalogSection() {
  const groups = Store.getGroups();
  const box = el(`<div class="admin-controls" style="margin-bottom:18px;">
    <h4>그룹(커뮤니티) 카탈로그</h4>
    <div class="hint" style="margin-bottom:8px;">그룹 생성은 슈퍼바이저만 할 수 있습니다 — 이 데모에서는 관리자 계정이 슈퍼바이저를 겸합니다.</div>
    <div style="margin-bottom:10px;">${groups.map(g => `<span class="tag">${g.name} · ${GROUP_TYPE_LABELS[g.type] || g.type}</span>`).join('') || '<span class="hint">등록된 그룹이 없습니다.</span>'}</div>
    <div class="btn-row" style="margin-top:0;">
      <input id="grp-name" type="text" placeholder="그룹명 (예: 대전)" style="flex:2;" autocomplete="off">
      <select id="grp-type" style="flex:1;">
        <option value="region">지역</option>
        <option value="community">커뮤니티</option>
        <option value="industry">산업군</option>
      </select>
      <button class="btn btn-sm" id="grp-create">그룹 생성</button>
    </div>
  </div>`);
  box.querySelector('#grp-create').addEventListener('click', () => {
    const nameEl = box.querySelector('#grp-name');
    if (!nameEl.value.trim()) return;
    Store.createGroup({ name: nameEl.value.trim(), type: box.querySelector('#grp-type').value }, 'admin-supervisor');
    render();
  });
  return box;
}
function renderUsersTab() {
  const users = Store.getUsers();
  const wrap = el(`<div></div>`);
  wrap.appendChild(renderGroupCatalogSection());
  wrap.appendChild(el(`<div class="hint" style="margin-bottom:14px;">전화번호가 공통 식별자입니다 — 같은 번호로 여러 역할에 로그인하거나 계약을 등록하면 한 사용자 아래 역할 속성이 함께 쌓입니다("한 사람 = 하나의 계정 + 여러 역할 속성" 원칙, user-account-role-model-spec.md 1.1절).</div>`));
  if (users.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">👤</div>아직 식별된 사용자가 없습니다. 고객이 계약을 등록하거나 카마스터/시공업체/배송기사가 로그인하면 여기 나타납니다.</div>`));
    return wrap;
  }
  const table = el(`<table><tr><th>이름</th><th>전화번호</th><th>보유 역할</th><th>겸임 여부</th></tr></table>`);
  users.forEach(u => {
    const roles = (u.roleAttributes || []).map(ra => ROLE_ATTR_LABELS[ra.role] || ra.role);
    const tr = elRow(`<tr><td>${u.name || '-'}</td><td>${u.phone}</td><td>${roles.map(r => `<span class="tag">${r}</span>`).join('') || '-'}</td><td>${roles.length > 1 ? '<span class="badge done">겸임중</span>' : '-'}</td></tr>`);
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

// ===================== 업체 승인 탭 (user-account-role-model-spec.md 4.3절) =====================
// 신규 등록된 업체(verificationStatus:'pending')를 사업자등록증 이미지로 육안 확인 후 승인/반려한다.
// 이 데모에서는 슈퍼바이저/커뮤니티관리자가 아직 분리되지 않아 관리자 계정이 커뮤니티관리자를 겸한다.
function renderShopApprovalTab(admin) {
  const shops = Store.getShops().filter(s => shopInAdminScope(s, admin));
  const pending = shops.filter(s => s.verificationStatus === 'pending');
  const processed = shops.filter(s => s.verificationStatus !== 'pending');
  const wrap = el(`<div></div>`);
  const scopeNote = admin.adminScope === 'community' ? ' 담당 그룹에 속한 업체만 보입니다.' : '';
  wrap.appendChild(el(`<div class="hint" style="margin-bottom:14px;">신규 업체 등록 요청을 사업자등록증 이미지로 육안 확인한 뒤 승인/반려합니다. 승인 전에는 고객 화면에 노출되지 않습니다.${scopeNote}</div>`));
  if (pending.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">🏢</div>승인 대기 중인 업체가 없습니다.</div>`));
  } else {
    pending.forEach(s => {
      const groupNames = (s.groupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '-';
      const card = el(`<div class="admin-controls">
        <h4>${s.name} <span class="badge wait">승인 대기</span></h4>
        <div class="summary-line"><span>대표 전화번호</span><span>${s.phone}</span></div>
        <div class="summary-line"><span>사업자등록번호</span><span>${s.businessRegistrationNumber}</span></div>
        <div class="summary-line"><span>대표자성명</span><span>${s.businessRepresentativeName}</span></div>
        <div class="summary-line"><span>개업일자</span><span>${s.businessStartDate}</span></div>
        <div class="summary-line"><span>소속 그룹</span><span>${groupNames}</span></div>
        ${s.businessRegistrationDocUrl ? `<img src="${s.businessRegistrationDocUrl}" style="max-width:200px;border-radius:8px;border:1px solid #ddd;margin-top:8px;">` : '<div class="hint">사업자등록증 이미지 없음</div>'}
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="shop-approve-${s.id}">승인</button>
          <button class="btn btn-danger btn-sm" id="shop-reject-${s.id}">반려</button>
        </div>
      </div>`);
      card.querySelector(`#shop-approve-${s.id}`).addEventListener('click', () => { Store.approveShop(s.id); render(); });
      card.querySelector(`#shop-reject-${s.id}`).addEventListener('click', () => { Store.rejectShop(s.id); render(); });
      wrap.appendChild(card);
    });
  }
  if (processed.length) {
    wrap.appendChild(el(`<h3 style="margin-top:20px;">전체 업체 현황</h3>`));
    const table = el(`<table><tr><th>업체명</th><th>상태</th><th>소속 그룹</th></tr></table>`);
    processed.forEach(s => {
      const ok = !s.verificationStatus || s.verificationStatus === 'approved';
      const statusLabel = ok ? '승인됨' : '반려됨';
      const groupNames = (s.groupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '-';
      table.appendChild(elRow(`<tr><td>${s.name}</td><td><span class="badge ${ok ? 'done' : 'warn'}">${statusLabel}</span></td><td>${groupNames}</td></tr>`));
    });
    wrap.appendChild(table);
  }
  return wrap;
}

// ===================== 신차인도서비스 탭 =====================
function renderDeliveryTab(list) {
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="btn-row" style="justify-content:flex-end;margin-bottom:16px;">
    <button class="btn btn-primary" style="width:auto;padding:13px 26px;" onclick="toggleNewForm()">${showNewForm ? '← 목록으로' : '+ 계약 대리 등록'}</button>
  </div>`));

  const kpiWrap = el(`<div class="kpi-row"></div>`);
  const codeNeeded = list.filter(r => r.stage === '고객요청').length;
  const pendingConfirm = list.filter(r => r.stage === '계약등록').length;
  const releaseReady = list.filter(r => Store.canRequestRelease(r)).length;
  const inTransit = list.filter(r => r.transit && r.transit.active).length;
  const done = list.filter(r => r.stage === 'CONFIRMED').length;
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
    const tr = elRow(`<tr class="clickable ${r.id === selectedId ? 'active-row' : ''}"><td>${r.id}</td><td>${r.customer.name}</td><td><span class="badge ${stageBadgeClass(r.stage)}">${stageDisplayLabel(r.stage)}</span></td></tr>`);
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

// 목적지 유형(destinationType) 선택 버튼 3개 — 계약 대리 등록/승인 대리 처리 화면에서 공용으로 쓴다.
function destinationTypeButtonsHTML(idPrefix) {
  return DESTINATION_TYPE_OPTIONS.map(o => `<button class="btn btn-sm" id="${idPrefix}-${o.code}">${o.label}</button>`).join('');
}
function wireDestinationTypeButtons(container, idPrefix, onSelect) {
  DESTINATION_TYPE_OPTIONS.forEach(o => {
    container.querySelector(`#${idPrefix}-${o.code}`).addEventListener('click', () => onSelect(o.code));
  });
}

// 소속 그룹(Group) 다중 선택 체크박스 — 카마스터 대리 등록/승인 대리 처리 화면에서 쓴다.
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

// ===================== 계약 대리 등록 (카마스터 대신) =====================
let newContractDraft = { karmasterId: null, name: '', phone: '', nickname: '', carModel: '', carBrand: '', contractNumber: '', destinationType: null };
function renderNewContractForm() {
  const d = newContractDraft;
  const kmCards = Store.getKarmasters().map(k => `<div class="km-card ${d.karmasterId === k.id ? 'sel' : ''}" onclick="selectDraftKarmaster('${k.id}')"><div class="name">${k.name}</div></div>`).join('');
  const wrap = el(`<div style="max-width:560px;">
    <h3>계약 대리 등록</h3>
    <div class="btn-row" style="margin-top:0;justify-content:flex-start;">
      <button class="btn btn-sample" id="a-nc-sample-fill" type="button">🧪 샘플로 채우기 (데모용)</button>
    </div>
    <label>담당 카마스터</label>
    <div class="km-grid">${kmCards}</div>
    <label>고객 실명</label><input id="a-nc-name" type="text" placeholder="홍길동" autocomplete="off">
    <label>고객 연락처</label><input id="a-nc-phone" type="tel" placeholder="010-1234-5678" autocomplete="off">
    <label>확정 차종</label><input id="a-nc-car" type="text" placeholder="예: 쏘렌토 하이브리드" autocomplete="off">
    <label>제조사</label>
    <select id="a-nc-brand">
      <option value="">선택 안 함</option>
      <option value="현대">현대</option>
      <option value="기아">기아</option>
      <option value="기타">기타</option>
    </select>
    <label>제조사 계약번호</label><input id="a-nc-contract-no" type="text" placeholder="계약서에 적힌 실제 계약번호" autocomplete="off">
    <label style="margin-top:8px;">목적지 유형</label>
    <div class="btn-row" style="margin-top:0;">${destinationTypeButtonsHTML('a-nc-dest')}</div>
    <div class="hint" id="a-nc-status"></div>
    <button class="btn btn-primary btn-auto" id="a-nc-submit" style="margin-top:14px;" disabled>계약 대리 등록</button>
  </div>`);
  const nameEl = wrap.querySelector('#a-nc-name'), phoneEl = wrap.querySelector('#a-nc-phone'), carEl = wrap.querySelector('#a-nc-car'), brandEl = wrap.querySelector('#a-nc-brand'), contractNoEl = wrap.querySelector('#a-nc-contract-no');
  const statusEl = wrap.querySelector('#a-nc-status'), submitBtn = wrap.querySelector('#a-nc-submit');
  nameEl.value = d.name; phoneEl.value = d.phone; carEl.value = d.carModel; brandEl.value = d.carBrand; contractNoEl.value = d.contractNumber;
  function refreshStatus() { statusEl.textContent = d.destinationType ? destinationTypeLabel(d.destinationType) : '선택되지 않음'; }
  function validate() { submitBtn.disabled = !(d.karmasterId && d.name.trim().length >= 2 && /^010-?\d{3,4}-?\d{4}$/.test(d.phone) && d.carModel.trim().length >= 2 && d.carBrand && d.contractNumber.trim() && d.destinationType !== null); }
  refreshStatus(); validate();
  nameEl.addEventListener('input', () => { d.name = nameEl.value; validate(); });
  phoneEl.addEventListener('input', () => { d.phone = phoneEl.value; validate(); });
  carEl.addEventListener('input', () => { d.carModel = carEl.value; validate(); });
  brandEl.addEventListener('change', () => { d.carBrand = brandEl.value; validate(); });
  contractNoEl.addEventListener('input', () => { d.contractNumber = contractNoEl.value; validate(); });
  wireDestinationTypeButtons(wrap, 'a-nc-dest', (code) => { d.destinationType = code; refreshStatus(); validate(); });
  wrap.querySelector('#a-nc-sample-fill').addEventListener('click', () => {
    // 이름·전화번호·계약번호 전부 "테스트/SAMPLE"이 한눈에 보이는 값으로 채운다 — 담당 카마스터·목적지
    // 유형은 첫 번째 카마스터와 "영업소 직행"으로 자동 선택해 곧바로 제출까지 이어질 수 있게 한다.
    const firstKm = Store.getKarmasters()[0];
    newContractDraft = {
      karmasterId: firstKm ? firstKm.id : null,
      name: '테스트고객', phone: '010-0000-0000', nickname: '',
      carModel: '테스트카', carBrand: '기타', contractNumber: 'SAMPLE-' + Math.floor(1000 + Math.random() * 9000),
      destinationType: 'DEALERSHIP',
    };
    render();
  });
  wrap.querySelector('#a-nc-submit').addEventListener('click', () => {
    const r = Store.createContractRecordDirect({
      karmasterId: d.karmasterId,
      customer: { name: d.name.trim(), phone: d.phone, nickname: '' },
      carModel: d.carModel.trim(),
      carBrand: d.carBrand,
      contractNumber: d.contractNumber.trim(),
      destinationType: d.destinationType,
    });
    newContractDraft = { karmasterId: null, name: '', phone: '', nickname: '', carModel: '', carBrand: '', contractNumber: '', destinationType: null };
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
      <tr><th>제조사 계약번호</th><th>차종</th><th>카마스터</th><th>목적지 유형</th><th>단계</th><th>연락처</th></tr>
      <tr><td>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</td><td>${r.carModel || '-'}</td><td>${km ? km.name : '-'}</td><td>${destinationTypeLabel(r.destinationType)}</td>
      <td><span class="badge ${stageBadgeClass(r.stage)}">${stageDisplayLabel(r.stage)}</span></td><td>${r.customer.phone}</td></tr>
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

// Layer 2(매니저 보강 정보) 관리자 대리 처리 — 상세 입력 폼 대신, 데모용 샘플 값을 즉시 게시하는
// 버튼 하나로 대신한다(관리자는 신속 진행이 목적이라 카마스터용 상세 폼을 그대로 옮기지 않았다).
function sampleAugmentationPatch(r) {
  const now = new Date(Date.now() + 30 * 60000);
  const pad = n => String(n).padStart(2, '0');
  const eta = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return {
    driverName: '관리자 대리입력 기사', driverPhone: '010-0000-0000',
    eta, locationNote: '고객 근처 주요 도로 통과 중 (관리자 대리 입력)',
    customizingProgress: r.stage === 'CUSTOMIZING' ? '공정 진행 중 (관리자 대리 입력)' : '',
    delayReasonCode: r.stage === 'EXCEPTION' ? 'dispatch_delay' : '',
    delayReasonNote: r.stage === 'EXCEPTION' ? '관리자 대리 입력 — 배정 지연' : '',
  };
}
function renderLayer2QuickActions(r) {
  const wrap = el(`<div style="margin-top:10px;"></div>`);
  const publishBtn = el(`<button class="btn btn-sm">배송 보강 정보 대리 게시 (샘플 ETA/위치코멘트)</button>`);
  publishBtn.addEventListener('click', () => { Store.publishAugmentation(r.id, sampleAugmentationPatch(r)); render(); });
  wrap.appendChild(publishBtn);
  if (r.stage === 'DELIVERED' || r.stage === 'CUSTOMIZING') {
    const field = r.stage === 'DELIVERED' ? 'deliveryPhotos' : 'customizingPhotos';
    const addFn = r.stage === 'DELIVERED' ? 'addDeliveryPhoto' : 'addCustomizingPhoto';
    const label = r.stage === 'DELIVERED' ? '인수 완료 사진' : '커스터마이징 현장 사진';
    const count = ((Store.getAugmentation(r)[field] || []).filter(p => !p.withdrawn)).length;
    const photoBtn = el(`<button class="btn btn-sm" style="margin-left:8px;">${label} 샘플 대리 업로드 (${count}/6)</button>`);
    photoBtn.addEventListener('click', () => { Store[addFn](r.id, generateSamplePhoto(count, `${label} ${count + 1}`), `${label} ${count + 1}`); render(); });
    wrap.appendChild(photoBtn);
  }
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
    box2.appendChild(renderLayer2QuickActions(r));
    inner.appendChild(box2);
    return box;
  }

  if (r.stage === '고객요청' && !r.karmasterId) {
    // 고객이 미등록 카마스터를 지정해 시작한 실제 요청 건 — 관리자가 카마스터 등록과 계약 승인을 함께 대리한다.
    const d = adminOnboardDrafts[r.id] || (adminOnboardDrafts[r.id] = { name: '', groupIds: [], destinationType: null });
    const form = el(`<div>
      <div class="hint" style="margin-bottom:8px;">미등록 카마스터 연락처: <b>${r.pendingKarmasterPhone}</b> · 조회번호: <b>${r.confirmCode}</b></div>
      <div class="summary-line"><span>제조사 계약번호</span><span>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</span></div>
      <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>
      <label style="margin-top:12px;">카마스터 이름</label><input id="a-ob-name" type="text" autocomplete="off">
      <label>소속 그룹 (복수 선택 가능, 승인 불필요)</label>
      <div>${groupCheckboxesHTML('a-ob-grp', d.groupIds)}</div>
      <label style="margin-top:8px;">목적지 유형</label>
      <div class="btn-row" style="margin-top:0;">${destinationTypeButtonsHTML('a-ob-dest')}</div>
      <div class="hint" id="a-ob-status"></div>
      <button class="btn btn-primary btn-sm" id="a-ob-submit" style="margin-top:8px;" disabled>카마스터 대리 등록 + 계약 승인</button>
    </div>`);
    const nameInput = form.querySelector('#a-ob-name');
    const statusEl = form.querySelector('#a-ob-status'), submitBtn = form.querySelector('#a-ob-submit');
    nameInput.value = d.name;
    function refreshStatus() { statusEl.textContent = d.destinationType ? destinationTypeLabel(d.destinationType) : '선택되지 않음'; }
    function check() { submitBtn.disabled = !(d.name.trim().length >= 2 && d.destinationType !== null); }
    refreshStatus(); check();
    nameInput.addEventListener('input', () => { d.name = nameInput.value; check(); });
    wireGroupCheckboxes(form, 'a-ob-grp', d);
    wireDestinationTypeButtons(form, 'a-ob-dest', (code) => { d.destinationType = code; refreshStatus(); check(); });
    submitBtn.addEventListener('click', () => {
      Store.approveContractAsUnregistered(r.id, { name: d.name.trim(), groupIds: d.groupIds, destinationType: d.destinationType, consultMemo: '' });
      delete adminOnboardDrafts[r.id];
      render();
    });
    inner.appendChild(form);
  } else if (r.stage === '고객요청') {
    // 고객이 직접 시작한 실제 요청 건(이미 등록된 카마스터 대상) — 관리자는 카마스터를 대신해 계약
    // 내용을 검토·승인하는 절차를 대리한다.
    const d = adminFillDrafts[r.id] || (adminFillDrafts[r.id] = { destinationType: null });
    const form = el(`<div>
      <div class="summary-line"><span>제조사 계약번호</span><span>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</span></div>
      <div class="summary-line"><span>차량</span><span>${r.carModel}${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}</span></div>
      <div class="summary-line"><span>계약일자</span><span>${r.contractDate || '-'}</span></div>
      <label style="margin-top:8px;">목적지 유형</label>
      <div class="btn-row" style="margin-top:0;">${destinationTypeButtonsHTML('a-fill-dest')}</div>
      <div class="hint" id="a-fill-status"></div>
      <button class="btn btn-primary btn-sm" id="a-fill-submit" style="margin-top:8px;" disabled>계약 내용 대리 승인</button>
    </div>`);
    const statusEl = form.querySelector('#a-fill-status'), submitBtn = form.querySelector('#a-fill-submit');
    function refreshStatus() { statusEl.textContent = d.destinationType ? destinationTypeLabel(d.destinationType) : '선택되지 않음'; }
    function check() { submitBtn.disabled = d.destinationType === null; }
    refreshStatus(); check();
    wireDestinationTypeButtons(form, 'a-fill-dest', (code) => { d.destinationType = code; refreshStatus(); check(); });
    submitBtn.addEventListener('click', () => {
      Store.fillContractDetails(r.id, { destinationType: d.destinationType, consultMemo: '' });
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
  } else if (r.stage === 'CUSTOMIZING') {
    const box = el(`<div><div class="hint" style="margin-bottom:8px;">차량이 ${r.karmasterShopName || '지정업체'}에 도착했습니다 — 카마스터-업체 간 별개 거래이며 고객은 관여하지 않습니다.</div><button class="btn btn-primary btn-sm">시공완료 확인 대리 처리 →</button></div>`);
    box.querySelector('button').addEventListener('click', () => { Store.confirmKarmasterShopDone(r.id); render(); });
    box.appendChild(renderLayer2QuickActions(r));
    inner.appendChild(box);
  } else if (r.stage === 'DELIVERED') {
    const box = el(`<div></div>`);
    const btn = el(`<button class="btn btn-primary btn-sm">개인수령확인+수령 확인 대리 처리 (양쪽 모두)</button>`);
    btn.addEventListener('click', () => { Store.forceConfirmDeliveryBoth(r.id); render(); });
    box.appendChild(btn);
    box.appendChild(renderLayer2QuickActions(r));
    inner.appendChild(box);
  } else if (r.stage === 'EXCEPTION') {
    const box = el(`<div><div class="msg-box" style="border-left-color:#c22;">⚠ 지연/예외 사유(내부 전용): ${r.exceptionReason || '(미입력)'}</div><button class="btn btn-primary btn-sm" style="margin-top:8px;">정상 운행 복귀 대리 처리</button></div>`);
    box.querySelector('button').addEventListener('click', () => { Store.clearException(r.id); render(); });
    box.appendChild(renderLayer2QuickActions(r));
    inner.appendChild(box);
  } else if (r.stage === 'CONFIRMED') {
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
  const shop = Store.getApprovedShops()[0];
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
