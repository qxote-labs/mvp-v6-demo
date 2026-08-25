/* shop.js (v6) — 신차 케어 서비스는 신차인도서비스와 완전히 독립된 최상위 계약(Store.getCareOrders())이다.
 * 시공사는 온라인으로 들어온 견적 요청에 가격을 회신하는 것부터 시작해서, 차량이 입고되면 스스로
 * "입고 확인"을 누르고(그 차가 신차인도서비스 배송에 얹혀 왔든 고객이 나중에 직접 몰고 왔든 상관하지
 * 않는다), 기존 시공 흐름(입고완료→작업중→최종검수→고객검수→출차→2차배송)을 그대로 이어간다.
 * 카마스터는 이 흐름에 전혀 관여하지 않으므로 고객 검수는 오너 단독 확인으로 진행된다. */
let loggedInShopId = sessionStorage.getItem('v6_shop_id') || null;
let showRegister = false;

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInShopId) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(showRegister ? renderRegister() : renderLogin());
    return;
  }
  const shop = Store.getShop(loggedInShopId);
  document.getElementById('header-right').textContent = `${shop.name} 로그인중`;
  if (shop.verificationStatus === 'pending') { root.appendChild(renderPendingApproval(shop)); return; }
  if (shop.verificationStatus === 'rejected') { root.appendChild(renderRejected(shop)); return; }
  root.appendChild(renderDashboard(shop));
}

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}

// 실제 서비스와 동일하게 사업자 연락처 입력으로 로그인하는 화면을 기본으로 두고, 테스트 시 번거로움을
// 줄이기 위해 평소엔 접혀 있는 "빠른 로그인" 드롭다운만 아래에 덧붙인다.
function renderLogin() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">시공업체 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 사업자 연락처로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <input type="password" placeholder="비밀번호 (추후 지원 예정)" disabled style="margin-bottom:8px;">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleRegister()">아직 계정이 없으신가요? 신규 업체 등록하기</button>
    </div>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:11.5px;color:#888;">데모 계정으로 빠른 로그인</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getShops().map(s => `<option value="${s.id}">${s.name} · ${s.phone}</option>`).join('')}
      </select>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  submitBtn.addEventListener('click', () => {
    const shop = Store.getShopByPhone(phoneEl.value);
    if (!shop) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    tryLogin(shop.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function tryLogin(id) {
  loggedInShopId = id; sessionStorage.setItem('v6_shop_id', id);
  const shop = Store.getShop(id);
  if (shop) Store.touchUserRole(shop.phone, shop.name, 'shop'); // 통합 User에 shop 역할 속성 부착(상호주의 원칙, 겸임 시연용)
  render();
}
function logout() { loggedInShopId = null; sessionStorage.removeItem('v6_shop_id'); render(); }
function toggleRegister() { showRegister = !showRegister; registerDraft = { name: '', phone: '', businessRegistrationNumber: '', businessRepresentativeName: '', businessStartDate: '', businessRegistrationDocUrl: '', groupIds: [] }; render(); }

// ===================== 신규 업체 등록 (user-account-role-model-spec.md 4.3절) =====================
// 사업자등록번호+대표자성명+개업일자를 "진위확인 API"에 넘겨(이 데모에서는 형식·필수값 검증으로
// 시뮬레이션) 통과해야 등록되며, 등록 직후에는 verificationStatus:'pending'이라 고객에게 보이지 않는다
// — 커뮤니티관리자(이 데모에서는 관리자가 겸함)가 승인해야 비로소 노출된다.
let registerDraft = { name: '', phone: '', businessRegistrationNumber: '', businessRepresentativeName: '', businessStartDate: '', businessRegistrationDocUrl: '', groupIds: [] };
function renderRegister() {
  const d = registerDraft;
  const groups = Store.getGroups();
  const wrap = el(`<div style="max-width:480px;">
    <h2>신규 업체 등록</h2>
    <div class="sub">사업자등록번호 등 기본 정보를 입력하면 저장 시점에 진위확인을 거칩니다(데모에서는 형식·필수값만 확인). 통과 후에는 커뮤니티관리자 승인이 있어야 고객에게 노출됩니다.</div>
    <label>업체명</label>
    <input id="rg-name" type="text" placeholder="예: 울산 D샵" autocomplete="off">
    <label>대표 전화번호</label>
    <input id="rg-phone" type="tel" placeholder="010-0000-0000" autocomplete="off">
    <label>사업자등록번호 (숫자 10자리)</label>
    <input id="rg-bn" type="text" placeholder="예: 1234567890" autocomplete="off">
    <label>대표자성명</label>
    <input id="rg-repname" type="text" placeholder="홍길동" autocomplete="off">
    <label>개업일자</label>
    <input id="rg-start" type="date" autocomplete="off">
    <label>사업자등록증 이미지</label>
    <div id="rg-doc-preview" style="margin-bottom:6px;"></div>
    <div class="btn-row" style="margin-top:0;">
      <button class="btn btn-sm" id="rg-doc-sample">샘플 이미지 추가</button>
      <label class="btn btn-sm" style="cursor:pointer;">파일 선택 업로드<input type="file" id="rg-doc-file" accept="image/*" style="display:none;"></label>
    </div>
    <label style="margin-top:10px;">소속 그룹 (복수 선택 가능, 승인 불필요)</label>
    <div>${groups.map(g => `<label style="display:inline-flex;align-items:center;gap:4px;margin:0 12px 6px 0;font-weight:400;font-size:12.5px;"><input type="checkbox" id="rg-grp-${g.groupId}">${g.name}</label>`).join('') || '<div class="hint">등록된 그룹이 없습니다.</div>'}</div>
    <button class="btn btn-primary btn-auto" id="rg-submit" style="margin-top:14px;">등록하기</button>
    <div class="hint" id="rg-hint" style="margin-top:8px;"></div>
    <button class="btn btn-outline btn-auto" style="margin-top:8px;" onclick="toggleRegister()">← 로그인 화면으로</button>
  </div>`);
  const nameEl = wrap.querySelector('#rg-name'), phoneEl = wrap.querySelector('#rg-phone'), bnEl = wrap.querySelector('#rg-bn');
  const repnameEl = wrap.querySelector('#rg-repname'), startEl = wrap.querySelector('#rg-start');
  const docPreview = wrap.querySelector('#rg-doc-preview'), hintEl = wrap.querySelector('#rg-hint');
  nameEl.value = d.name; phoneEl.value = d.phone; bnEl.value = d.businessRegistrationNumber; repnameEl.value = d.businessRepresentativeName; startEl.value = d.businessStartDate;
  function refreshDocPreview() {
    docPreview.innerHTML = d.businessRegistrationDocUrl ? `<img src="${d.businessRegistrationDocUrl}" style="max-width:160px;border-radius:8px;border:1px solid #ddd;">` : '<div class="hint">아직 첨부된 이미지가 없습니다.</div>';
  }
  refreshDocPreview();
  nameEl.addEventListener('input', () => { d.name = nameEl.value; });
  phoneEl.addEventListener('input', () => { d.phone = loginPhoneFormat(phoneEl.value); phoneEl.value = d.phone; });
  bnEl.addEventListener('input', () => { d.businessRegistrationNumber = bnEl.value; });
  repnameEl.addEventListener('input', () => { d.businessRepresentativeName = repnameEl.value; });
  startEl.addEventListener('change', () => { d.businessStartDate = startEl.value; });
  wrap.querySelector('#rg-doc-sample').addEventListener('click', () => { d.businessRegistrationDocUrl = generateSamplePhoto(0, '사업자등록증(샘플)'); refreshDocPreview(); });
  wrap.querySelector('#rg-doc-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => { d.businessRegistrationDocUrl = reader.result; refreshDocPreview(); };
    reader.readAsDataURL(file);
  });
  groups.forEach(g => {
    wrap.querySelector(`#rg-grp-${g.groupId}`).addEventListener('change', (e) => {
      if (e.target.checked) { if (!d.groupIds.includes(g.groupId)) d.groupIds.push(g.groupId); }
      else d.groupIds = d.groupIds.filter(id => id !== g.groupId);
    });
  });
  wrap.querySelector('#rg-submit').addEventListener('click', () => {
    const result = Store.registerShop({
      name: d.name.trim(), phone: d.phone, businessRegistrationNumber: d.businessRegistrationNumber,
      businessRepresentativeName: d.businessRepresentativeName, businessStartDate: d.businessStartDate,
      businessRegistrationDocUrl: d.businessRegistrationDocUrl, groupIds: d.groupIds,
    });
    if (result.error) { hintEl.textContent = result.message; return; }
    showRegister = false;
    tryLogin(result.shop.id);
  });
  return wrap;
}
function renderPendingApproval(shop) {
  return el(`<div style="max-width:480px;margin:60px auto;text-align:center;">
    <div class="big" style="font-size:40px;">⏳</div>
    <h2>승인 대기 중</h2>
    <div class="sub">${shop.name}의 사업자등록 정보를 커뮤니티관리자가 확인하고 있습니다. 승인되면 고객 화면에 노출되고 정상적으로 견적 요청을 받을 수 있습니다.</div>
    <button class="btn btn-outline btn-auto" style="margin-top:14px;" onclick="logout()">로그아웃</button>
  </div>`);
}
function renderRejected(shop) {
  return el(`<div style="max-width:480px;margin:60px auto;text-align:center;">
    <div class="big" style="font-size:40px;">🚫</div>
    <h2>승인 반려됨</h2>
    <div class="sub">${shop.name}의 등록 신청이 반려되었습니다. 문의사항은 고객센터로 연락해 주세요.</div>
    <button class="btn btn-outline btn-auto" style="margin-top:14px;" onclick="logout()">로그아웃</button>
  </div>`);
}

function renderDashboard(shop) {
  const mine = Store.getCareOrders().filter(c => c.shopId === shop.id);
  const quoteRequests = mine.filter(c => c.status === 'requested');
  const awaitingCustomer = mine.filter(c => c.status === 'quoted');
  const incoming = mine.filter(c => c.status === 'confirmed');
  const active = mine.filter(c => SHOP_DISPLAY_STAGES.some(s => s.code === c.status));
  const done = mine.filter(c => c.status === '수령확인' || c.status === '수령대기');

  const wrap = el(`<div>
    <div class="btn-row" style="justify-content:flex-end;margin-bottom:16px;"><button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="logout()">로그아웃</button></div>
    <div class="kpi-row">
      <div class="kpi-box"><div class="v">${quoteRequests.length}</div><div class="k">견적 요청 대기</div></div>
      <div class="kpi-box"><div class="v">${incoming.length}</div><div class="k">계약완료 — 입고 대기</div></div>
      <div class="kpi-box"><div class="v">${active.length}</div><div class="k">진행중 시공</div></div>
      <div class="kpi-box"><div class="v">${done.length}</div><div class="k">처리 완료</div></div>
    </div>
    <h3>견적 요청 (온라인/방문 견적 대기)</h3>
    <div id="quote-list"></div>
    <h3 style="margin-top:24px;">계약 완료 — 입고 대기</h3>
    <div id="incoming-list"></div>
    <h3 style="margin-top:24px;">진행중 시공</h3>
    <div id="active-list"></div>
    <h3 style="margin-top:24px;">처리 완료</h3>
    <div id="done-list"></div>
  </div>`);

  const quoteBox = wrap.querySelector('#quote-list');
  if (quoteRequests.length === 0 && awaitingCustomer.length === 0) quoteBox.appendChild(el(`<div class="hint">현재 대기중인 견적 요청이 없습니다.</div>`));
  quoteRequests.forEach(c => quoteBox.appendChild(renderQuoteCard(c)));
  awaitingCustomer.forEach(c => quoteBox.appendChild(el(`<div class="admin-controls">
    <h4>${c.id} · ${c.carModel}</h4>
    <div class="hint">견적 ${fmtMoney(c.quotedPrice)}을 회신했습니다. 고객의 확인을 기다리는 중입니다.</div>
  </div>`)));

  // 계약은 완료됐지만 아직 입고 전인 건 — 차가 실제로 어떻게 왔는지(신차인도서비스 배송에 얹혀
  // 왔든, 고객이 나중에 직접 몰고 왔든)는 상관하지 않는다. 시공사가 스스로 입고를 확인하면 시작된다.
  const incomingBox = wrap.querySelector('#incoming-list');
  if (incoming.length === 0) incomingBox.appendChild(el(`<div class="hint">계약이 완료되어 입고를 기다리는 차량이 없습니다.</div>`));
  incoming.forEach(c => {
    const box = el(`<div class="admin-controls">
      <h4>${c.id} · ${c.customer.name} · ${c.carModel}</h4>
      <div class="hint" style="margin-bottom:8px;">신차 케어 서비스 계약이 완료되었습니다. 차량이 입고되면 아래에서 입고를 확인해 주세요.</div>
      <button class="btn btn-primary btn-sm" id="dropoff-${c.id}">입고 확인 →</button>
    </div>`);
    box.querySelector(`#dropoff-${c.id}`).addEventListener('click', () => { Store.confirmCareDropoff(c.id); render(); });
    incomingBox.appendChild(box);
  });

  const activeBox = wrap.querySelector('#active-list');
  if (active.length === 0) activeBox.appendChild(el(`<div class="hint">현재 진행중인 시공 건이 없습니다.</div>`));
  active.forEach(c => activeBox.appendChild(renderShopCard(c)));

  // 오너의 최종 수령확인 여부를 시공업체도 볼 수 있어야 한다 — 차를 넘긴 뒤 그걸로 끝이 아니라,
  // 실제로 무사히 도착·확인됐는지까지가 이 계약의 완료다.
  const doneBox = wrap.querySelector('#done-list');
  if (done.length === 0) doneBox.appendChild(el(`<div class="hint">아직 완료된 건이 없습니다.</div>`));
  done.slice().sort((a, b) => b.createdAt - a.createdAt).forEach(c => {
    const received = c.status === '수령확인';
    doneBox.appendChild(el(`<div class="admin-controls">
      <h4>${c.id} · ${c.customer.name} · ${c.carModel}</h4>
      <span class="badge ${received ? 'done' : 'wait'}">${received ? '오너 최종 수령확인 완료' : '오너 수령확인 대기중 (재배송 도착)'}</span>
    </div>`));
  });

  return wrap;
}

let quoteDrafts = {};
function renderQuoteCard(c) {
  const d = quoteDrafts[c.id] || (quoteDrafts[c.id] = { price: Store.aftermarketSuggestedPrice(c) });
  const card = el(`<div class="admin-controls">
    <h4>${c.id} · ${c.customer.name} · ${c.carModel}</h4>
    <div class="hint" style="margin-bottom:6px;">패키지: ${c.package.name}${c.options.length ? ` + ${c.options.map(o => o.name).join(', ')}` : ''} · 진행방식: ${c.mode === 'online' ? '온라인 즉시견적' : '방문 후 협의'}</div>
    <div class="summary-line"><span>참고 견적(기본+옵션 합)</span><span>${fmtMoney(Store.aftermarketSuggestedPrice(c))}</span></div>
    ${c.customRequest ? `<div class="msg-box" style="margin:10px 0;"><b>고객 요청사항</b><br>${c.customRequest}</div>` : ''}
    <label>최종 견적가</label>
    <input id="quote-price-${c.id}" type="number" min="0" step="10000" value="${d.price}">
    <button class="btn btn-primary btn-sm" id="quote-send-${c.id}" style="margin-top:10px;">견적 회신하기 →</button>
  </div>`);
  const priceInput = card.querySelector(`#quote-price-${c.id}`);
  priceInput.addEventListener('change', () => { d.price = Math.max(0, parseInt(priceInput.value, 10) || 0); priceInput.value = d.price; });
  card.querySelector(`#quote-send-${c.id}`).addEventListener('click', () => {
    Store.respondCareQuote(c.id, d.price);
    delete quoteDrafts[c.id];
    render();
  });
  return card;
}

let chargeDrafts = {};
function renderShopCard(c) {
  const quoted = c.quotedPrice || 0;
  const card = el(`<div class="admin-controls">
    <h4>${c.id} · ${c.customer.name} · ${c.carModel}</h4>
    <div class="hint" style="margin-bottom:6px;">패키지: ${c.package.name} · 견적가: ${fmtMoney(quoted)}</div>
    ${c.customRequest ? `<div class="msg-box" style="margin-bottom:10px;"><b>고객 요청사항</b><br>${c.customRequest}</div>` : ''}
    <div id="stage-slot-${c.id}"></div>
  </div>`);
  const slot = card.querySelector(`#stage-slot-${c.id}`);

  // 2차 배송이 이미 시작된 건이면(c.status는 여전히 '출차완료'로 남아있음) 상태 판단보다 우선해서
  // 배송 진행 현황을 보여준다 — 그래야 "배송 시작" 버튼이 계속 눌려서 재배정·중복 로그가 쌓이지 않는다.
  if (c.transit && c.transit.active) {
    const tp = transitProgress(c);
    slot.appendChild(el(`<div class="admin-controls">
      <h4>오너에게 배송중</h4>
      <div class="hint" style="margin-bottom:8px;">목적지: ${tp.destination} · 배송기사: ${tp.driverName}</div>
      ${renderDeliveryStepperHTML(c)}
      <div class="hint" style="margin-top:8px;">다음 위치까지 약 ${tp.remainSec}초 남음</div>
    </div>`));
  } else if (SHOP_STAGES.some(s => s.code === c.status)) {
    const idx = SHOP_STAGES.findIndex(s => s.code === c.status);
    const flowBox = el(`<div class="status-flow"></div>`);
    SHOP_STAGES.forEach((s, i) => {
      const btn = el(`<button class="${s.code === c.status ? 'current' : ''}" ${i !== idx + 1 ? 'disabled' : ''}>${s.short}</button>`);
      btn.addEventListener('click', () => { Store.setCareShopStage(c.id, s.code); render(); });
      flowBox.appendChild(btn);
    });
    slot.appendChild(flowBox);

    if (c.status === '작업중') {
      const photos = c.photos || [];
      const box = el(`<div class="admin-controls">
        <h4>현장 사진 업로드 (${photos.length}/3장)</h4>
        <div class="photo-row" style="margin-bottom:14px;">${photos.map(p => `<img src="${p.src}" style="flex:1;height:90px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`).join('') || '<div class="hint">아직 등록된 사진이 없습니다</div>'}</div>
        <div class="btn-row" style="margin-top:0;">
          <button class="btn btn-sm" id="photo-sample-${c.id}" ${photos.length >= 3 ? 'disabled' : ''}>샘플 이미지 추가</button>
          <label class="btn btn-sm" style="cursor:pointer;${photos.length >= 3 ? 'opacity:0.4;pointer-events:none;' : ''}">파일 선택 업로드<input type="file" id="photo-file-${c.id}" accept="image/*" style="display:none;"></label>
        </div>
      </div>`);
      box.querySelector(`#photo-sample-${c.id}`).addEventListener('click', () => { Store.addCareSamplePhoto(c.id, generateSamplePhoto); render(); });
      const fileInput = box.querySelector(`#photo-file-${c.id}`);
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => { Store.addCareUploadedPhoto(c.id, reader.result, file.name); render(); };
        reader.readAsDataURL(file);
      });
      slot.appendChild(box);
    }
    if (c.status === '최종검수') {
      const d = chargeDrafts[c.id] || (chargeDrafts[c.id] = { extra: 0, note: '' });
      const box = el(`<div class="admin-controls">
        <h4>청구 금액 정리</h4>
        <div class="summary-line"><span>기본 금액 (사전 견적가)</span><span>${fmtMoney(quoted)}</span></div>
        <label>추가 금액 (선택, 오버차지 발생 시)</label>
        <input id="extra-charge-${c.id}" type="number" min="0" step="10000" value="${d.extra}">
        <label>작업 내역 (선택)</label>
        <div class="hint" style="margin-bottom:6px;">현장 사진과는 별도로, 실제 수행한 작업과 청구 내역을 텍스트로 남겨주세요.</div>
        <textarea id="extra-note-${c.id}" rows="2" placeholder="예: 견적대로 시공 완료. 추가 요청 부위 보강 작업 포함">${d.note}</textarea>
        <div class="summary-line" style="margin-top:8px;"><span>합계 청구액</span><span id="charge-total-${c.id}">${fmtMoney(quoted + (d.extra || 0))}</span></div>
      </div>`);
      const extraInput = box.querySelector(`#extra-charge-${c.id}`);
      const noteInput = box.querySelector(`#extra-note-${c.id}`);
      const totalEl = box.querySelector(`#charge-total-${c.id}`);
      extraInput.addEventListener('change', () => {
        d.extra = Math.max(0, parseInt(extraInput.value, 10) || 0);
        extraInput.value = d.extra;
        totalEl.textContent = fmtMoney(quoted + d.extra);
      });
      noteInput.addEventListener('input', () => { d.note = noteInput.value; });
      slot.appendChild(box);

      const inspectBox = el(`<div class="admin-controls">
        <div class="hint" style="margin-bottom:8px;">아래 버튼을 누르면 청구 금액과 작업 내역이 한 번에 기록되고, 고객에게 최종 검수가 요청됩니다.</div>
        <button class="btn btn-primary btn-sm" id="request-inspect-${c.id}">고객 검수 요청 보내기 →</button>
      </div>`);
      inspectBox.querySelector(`#request-inspect-${c.id}`).addEventListener('click', () => {
        Store.setCareCharged(c.id, d.extra || 0, d.note);
        Store.requestCareInspection(c.id);
        delete chargeDrafts[c.id];
        render();
      });
      slot.appendChild(inspectBox);
    }
  } else if (c.status === '고객검수대기') {
    slot.appendChild(el(`<div class="admin-controls">
      <div class="hint" style="margin-bottom:8px;">고객 검수 대기 중입니다 — 지금은 시공업체가 조작할 항목이 없습니다.</div>
      <span class="badge ${c.ownerConfirmed ? 'done' : 'wait'}">${c.ownerConfirmed ? '오너 확인 완료' : '오너 확인 대기중'}</span>
      ${c.disputed ? `<div class="msg-box" style="margin-top:10px;border-left-color:#c22;">⚠ 고객이 불만족을 제기했습니다. 사유: ${c.disputeReason}</div>` : ''}
    </div>`));
  } else if (c.status === '출차완료') {
    const box = el(`<div class="admin-controls"><button class="btn btn-primary btn-auto" id="second-leg-${c.id}">배송 시작 (오너에게) →</button></div>`);
    box.querySelector(`#second-leg-${c.id}`).addEventListener('click', () => { Store.startCareSecondLeg(c.id); render(); });
    slot.appendChild(box);
  }
  return card;
}

Store.onChange(() => { render(); });

render();
