/* customer.js — 카마스터와의 상담은 앱 밖(오프라인 개별 연락)에서 이뤄지지만, 계약 처리는 반드시 고객이
 * 시작한다. 고객이 이미 체결한 계약의 내용(차량정보·계약일자·카마스터 연락처·본인 정보)을 직접 입력해
 * 등록하면, 카마스터가 그 내용을 검토·승인한다 — 카마스터가 고객 정보를 임의로 입력하는 절차는 없다.
 * 출고 후 시공은 신차인도서비스 계약 안의 단순 옵션(시공예정 여부)일 뿐이고, 신차 케어 서비스는 그
 * 옵션과는 완전히 무관하게 "내 차량"(=신차인도서비스로 등록한 예약) 중 하나를 골라 언제든 독립적으로
 * 시작하는 별개 서비스다. */
let loggedInCustomer = !!sessionStorage.getItem('v6_customer_logged');
let loggedInName = sessionStorage.getItem('v6_customer_name') || '';
let loggedInPhone = sessionStorage.getItem('v6_customer_phone') || '';
let view = sessionStorage.getItem('v6_view') || 'landing';
let activeId = sessionStorage.getItem('v6_active') || null;
let careActiveId = sessionStorage.getItem('v6_care_active') || null;
let historyPhone = sessionStorage.getItem('v6_history_phone') || '';
let kmSortDim = 'overall';

// 로그인한 계정 정보(이름/연락처)를 계약내역 등록 폼의 "내 이름/내 연락처" 기본값으로 쓴다 — 이미
// 로그인해서 신원이 확인된 상태인데 같은 정보를 또 타이핑하게 할 이유가 없다. 다만 실제 계약 당사자가
// 본인과 다른 경우(예: 가족 명의 계약)를 위해 값은 그대로 두되 입력창은 계속 수정 가능하게 둔다.
let requestDraft = { karmasterPhone: '', carModel: '', carBrand: '', contractNumber: '', trim: '', color: '', contractDate: '', name: loggedInName, phone: loggedInPhone, nickname: '' };
let amDraft = { shopId: null, packageId: PACKAGES[1].id, optionIds: [], mode: 'online', customRequest: '', pointsUsed: 0 };
let careSetupReservationId = null; // 신차 케어 서비스 신청 대상으로 고른 "내 차량"(=신차인도서비스 예약)
let ratingTarget = null; // { type: 'karmaster'|'shop', targetId, refId }
let releaseAddrDraft = ''; // 최종 수령지 입력 중 폴링 재렌더로 값이 날아가지 않도록 보존
let ratingScores = {};

function persistNav() {
  sessionStorage.setItem('v6_view', view);
  sessionStorage.setItem('v6_active', activeId || '');
  sessionStorage.setItem('v6_care_active', careActiveId || '');
}
function goto(v) { view = v; persistNav(); render(); }

let _rendering = false;
function render() {
  if (_rendering) return;
  _rendering = true;
  try { _renderInner(); } finally { _rendering = false; }
}

function _renderInner() {
  const root = document.getElementById('body-root');
  const focused = document.activeElement;
  let restore = null;
  if (focused && root.contains(focused) && focused.id && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA')) {
    restore = { id: focused.id, value: focused.value, selStart: typeof focused.selectionStart === 'number' ? focused.selectionStart : null, selEnd: typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null };
  }
  root.innerHTML = '';
  if (!loggedInCustomer) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(renderLoginMock());
    return;
  }
  const map = {
    landing: renderLanding, karmasters: renderKarmasterSearch, request: renderRequest, detail: renderDetail, history: renderHistory, rate: renderRating,
    care: renderCare, care_setup: renderCareSetup, care_detail: renderCareDetail,
  };
  let headerText = '';
  if (view === 'detail' && activeId) {
    const r = Store.getReservation(activeId);
    if (r) headerText = `내 예약번호: ${r.id}`;
  } else if (view === 'care_detail' && careActiveId) {
    const c = Store.getCareOrder(careActiveId);
    if (c) headerText = `신차 케어 서비스 계약번호: ${c.id}`;
  }
  document.getElementById('header-right').textContent = headerText;
  root.appendChild((map[view] || renderLanding)());
  if (restore) {
    const restored = document.getElementById(restore.id);
    if (restored) {
      restored.value = restore.value;
      restored.focus();
      if (restore.selStart !== null && restored.setSelectionRange) { try { restored.setSelectionRange(restore.selStart, restore.selEnd); } catch (e) {} }
    }
  }
}

// ===================== 로그인 (데모 화면 예시) =====================
function renderLoginMock() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">구매자 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">실제 서비스에서는 본인인증을 거쳐 로그인합니다. 데모에서는 아래 정보로 바로 진행되며, 입력한 이름·연락처는 계약내역 등록 시 자동으로 채워집니다.</div>
    <input id="login-name" type="text" placeholder="이름 (홍길동)" value="${loggedInName}" style="margin-bottom:10px;" autocomplete="off">
    <input id="login-phone" type="tel" placeholder="010-1234-5678" value="${loggedInPhone}" style="margin-bottom:10px;" autocomplete="off">
    <input type="password" placeholder="비밀번호 (추후 지원 예정)" disabled style="margin-bottom:14px;">
    <button class="btn btn-primary" style="width:100%;" id="login-submit" disabled>로그인</button>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:11.5px;color:#888;">데모 계정으로 빠른 로그인 (비밀번호 불필요)</label>
      <select id="quick-login-customer" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getDemoCustomers().map(c => `<option value="${c.phone}" data-name="${c.name}">${c.name} · ${c.note}</option>`).join('')}
      </select>
      <div class="hint" style="margin-top:4px;">이미 계약 이력이 있는 기가입 고객으로, 매 단계를 처음부터 밟지 않고도 바로 이어지는 화면을 확인할 수 있습니다. 신규 가입 테스트는 위 입력창에 새 이름·연락처를 직접 적으면 됩니다.</div>
    </div>
  </div>`);
  const nameEl = wrap.querySelector('#login-name'), phoneEl = wrap.querySelector('#login-phone'), submitBtn = wrap.querySelector('#login-submit');
  // 이름·연락처가 빈 채로도 "로그인"이 눌려 신원 없는 상태로 넘어가던 걸 막는다 — 데모 계정
  // 드롭다운이 이미 "빈 값 없이 곧바로 들어가는" 지름길을 담당하므로, 직접 입력 경로는 실제로 값이
  // 채워졌을 때만 눌리게 한다.
  function validateLogin() { submitBtn.disabled = !(nameEl.value.trim().length >= 2 && /^010-?\d{3,4}-?\d{4}$/.test(phoneEl.value)); }
  nameEl.addEventListener('input', validateLogin);
  phoneEl.addEventListener('input', () => { phoneEl.value = formatPhoneDigits(phoneEl.value); validateLogin(); });
  validateLogin();
  submitBtn.addEventListener('click', tryCustomerLogin);
  wrap.querySelector('#quick-login-customer').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.value) return;
    nameEl.value = opt.dataset.name;
    phoneEl.value = opt.value;
    validateLogin();
    tryCustomerLogin();
  });
  return wrap;
}
function formatPhoneDigits(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}
function tryCustomerLogin() {
  const name = (document.getElementById('login-name').value || '').trim();
  const phone = formatPhoneDigits(document.getElementById('login-phone').value);
  if (name.length < 2 || !/^010-?\d{3,4}-?\d{4}$/.test(phone)) return; // 버튼이 비활성 상태에서도 직접 호출될 일(데모 드롭다운)이 있어 한 번 더 막아둔다
  loggedInCustomer = true;
  loggedInName = name;
  loggedInPhone = phone;
  sessionStorage.setItem('v6_customer_logged', '1');
  sessionStorage.setItem('v6_customer_name', name);
  sessionStorage.setItem('v6_customer_phone', phone);
  requestDraft.name = name;
  requestDraft.phone = phone;
  render();
}

// ===================== 랜딩 =====================
// 신차인도서비스의 메인 동작은 "계약내역 등록"과 "계약 확인/이력조회" 두 가지다. "카마스터 찾기"는
// 계약과 무관하게 평판만 미리 확인하고 싶은 사람을 위한 부차 기능이라, 여기 상단 버튼줄에서는 빼고
// 아래쪽에 작은 링크로만 남긴다(계약내역 등록 폼 안에도 카마스터 연락처 입력 근처에 같은 링크가 있다).
function renderLanding() {
  return el(`<div style="max-width:640px;margin:40px auto;text-align:center;">
    <h2 style="font-size:24px;">신차인도서비스</h2>
    <div class="sub">카마스터를 찾아 직접 연락해 상담·계약을 진행하세요. 계약이 끝나면 그 내용을 직접 등록해 주세요. 이후 과정은 이 앱에서 실시간으로 확인할 수 있습니다.</div>
    <div style="display:flex;gap:14px;margin-top:30px;flex-wrap:wrap;">
      <button class="btn btn-primary" style="width:auto;flex:1;" onclick="goto('request')">계약내역 등록하기</button>
      <button class="btn btn-outline" style="width:auto;flex:1;" onclick="goto('history')">내 계약 확인 / 이력 조회</button>
    </div>
    <div style="margin-top:14px;"><a href="javascript:void(0)" onclick="goto('karmasters')" style="font-size:12.5px;color:#888;">계약과 무관하게 카마스터 평판만 확인하기 →</a></div>
    <hr style="margin:32px 0;border:none;border-top:1px solid #ddd;">
    <h2 style="font-size:24px;">신차 케어 서비스</h2>
    <div class="sub">신차인도서비스와는 시간적으로 완전히 분리된 별개 서비스입니다 — 출고 전이든, 이미 받은 차든 상관없이 시공·정비가 필요할 때 언제든 이용하세요.</div>
    <button class="btn btn-primary" style="width:100%;margin-top:16px;" onclick="goto('care')">신차 케어 서비스</button>
  </div>`);
}

// ===================== 카마스터 검색 (평점 기반, 순수 정보 제공용 — 여기서 바로 연결하지 않는다) =====================
// 탐색 화면에 "요청 시작" 버튼을 두면 예전 온라인 예약 흐름과 사실상 같아진다는 지적을 반영해,
// 이 화면은 리서치(누구에게 연락할지 고르기)용으로만 남기고, 실제 계약 요청은 별도 화면에서
// 고객이 "이미 상담한 카마스터의 연락처"를 직접 입력하는 것으로 시작한다.
function renderKarmasterSearch() {
  const dims = RATING_DIMS_KARMASTER;
  let list = Store.getKarmasters().map(k => ({ k, rt: Store.getRatingsFor('karmaster', k.id) }));
  if (kmSortDim === 'overall') {
    list.sort((a, b) => (b.rt.overall !== null ? b.rt.overall : b.k.rating) - (a.rt.overall !== null ? a.rt.overall : a.k.rating));
  } else {
    list.sort((a, b) => (b.rt.avgByDim[kmSortDim] !== null ? b.rt.avgByDim[kmSortDim] : -1) - (a.rt.avgByDim[kmSortDim] !== null ? a.rt.avgByDim[kmSortDim] : -1));
  }
  const cards = list.map(({ k, rt }) => `
    <div class="km-card" style="cursor:default;">
      <div class="name">${karmasterDisplayName(k)}</div>
      <div class="rating">${fmtStars(rt.overall !== null ? rt.overall : k.rating)} · ${rt.count > 0 ? `앱 내 평가 ${rt.count}건` : `초기 평점 ${k.reviews}건`}</div>
      <div class="region">${(k.groupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '-'}</div>
      <div style="margin-bottom:8px;">${k.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
      <ul class="pkg-items">${dims.map(d => `<li>${d.label}: ${rt.avgByDim[d.id] !== null ? rt.avgByDim[d.id].toFixed(1) : '-'}</li>`).join('')}</ul>
      <div class="addr-box" style="margin-top:10px;">연락처: <b>${k.phone}</b><br>전화나 문자로 직접 연락해 상담 일정을 잡아주세요.</div>
    </div>`).join('');
  const sortOpts = [['overall', '종합 평점순']].concat(dims.map(d => [d.id, `${d.label}순`]));

  // 아직 가입하지 않은 카마스터도, 다른 고객이 계약을 등록하며 그 전화번호를 남긴 순간부터 평판
  // 레코드가 쌓인다(UnclaimedKarmasterProfile, 4.2절) — 전화번호는 마스킹해서 보여준다.
  const unclaimed = Store.getUnclaimedKarmasters();
  const unclaimedCards = unclaimed.map(u => `
    <div class="km-card" style="cursor:default;">
      <div class="name">${Store.maskPhone(u.phone)}</div>
      <div class="rating">${u.reviews > 0 ? fmtStars(u.rating) + ` · 초기 평점 ${u.reviews}건` : '아직 평가 없음'}</div>
      <div class="region">미가입 카마스터</div>
      <div class="addr-box" style="margin-top:10px;">아직 앱에 가입하지 않은 카마스터입니다. 이미 상담·계약을 진행 중이라면 그 연락처로 계속 소통해 주세요.</div>
    </div>`).join('');

  const wrap = el(`<div>
    <h2>카마스터 찾기</h2>
    <div class="sub">리서치 전용 화면입니다. 상담·시승·계약은 오프라인(전화·문자)으로 직접 진행하고, 계약이 끝나면 "계약내역 등록하기"에서 그 내용을 직접 등록해 주세요.</div>
    <label>정렬 기준</label>
    <select id="km-sort" style="max-width:220px;">${sortOpts.map(([v, l]) => `<option value="${v}" ${kmSortDim === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="km-grid" style="margin-top:16px;flex-wrap:wrap;">${cards}</div>
    ${unclaimed.length > 0 ? `<h3 style="margin-top:24px;">미가입 카마스터 (평판만 확인 가능)</h3><div class="km-grid" style="margin-top:8px;flex-wrap:wrap;">${unclaimedCards}</div>` : ''}
    <div class="btn-row" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="goto('landing')">← 처음으로</button>
    </div>
  </div>`);
  wrap.querySelector('#km-sort').addEventListener('change', (e) => { kmSortDim = e.target.value; render(); });
  return wrap;
}

// ===================== 계약내역 등록 (고객이 직접 시작) =====================
// 이미 오프라인에서 체결된 계약을 디지털로 연결하는 절차다 — 목록에서 카마스터를 고르는 게 아니라,
// 계약서에 적힌 그대로(차량정보·계약일자 + 카마스터 연락처 + 본인 정보)를 고객이 직접 입력한다.
// 이 조합 자체가 실제 계약서를 양쪽 다 들고 있어야만 맞출 수 있는 지문 역할을 하므로, 등록된
// 카마스터라면 별도의 확인 코드 없이 카마스터가 화면에서 직접 검토·승인하는 것으로 충분하다.
// 입력한 연락처가 등록된 카마스터와 일치하지 않으면(미등록) 조회번호가 발급되며, 이건 앱이 대신
// 전달하지 않는다 — 실제 계약 당사자인 고객이 본인 채널로 직접 그 카마스터에게 알려야 한다.
function renderRequest() {
  const wrap = el(`<div style="max-width:480px;">
    <h2>계약내역 등록</h2>
    <div class="sub">이미 체결한 계약의 내용을 그대로 입력해 주세요. 카마스터가 등록되어 있다면 카마스터 화면에서 이 내용을 검토·승인하는 것으로 연결됩니다.</div>
    <div class="btn-row" style="margin-top:10px;justify-content:flex-start;">
      <button class="btn btn-sample" id="rq-sample-fill" type="button">🧪 샘플로 채우기 (데모용)</button>
    </div>
    <h3 style="margin-top:20px;">핵심 식별 정보</h3>
    <div class="hint" style="margin-bottom:10px;">브랜드·제조사 계약번호·계약자명 세 가지가 이 계약을 특정하는 키입니다 — 동명이인 구분과 향후 제조사 시스템 연동에 쓰이는 필수 정보입니다.</div>
    <label>제조사</label>
    <select id="rq-brand">
      <option value="">선택 안 함</option>
      <option value="현대">현대</option>
      <option value="기아">기아</option>
      <option value="기타">기타</option>
    </select>
    <label>제조사 계약번호</label>
    <input id="rq-contract-no" type="text" placeholder="계약서에 적힌 실제 계약번호" autocomplete="off">
    <div class="hint">이 앱이 자동 발급하는 접수번호(${'10-YYYYMM-NNNN'} 형식)와는 다른, 제조사·딜러가 발급한 실제 계약번호입니다.</div>
    <label>계약자명 (내 이름)</label>
    <input id="rq-name" type="text" placeholder="홍길동" autocomplete="off">
    ${(loggedInName || loggedInPhone) ? '<div class="hint">로그인한 계정 정보로 자동 입력했습니다. 계약 당사자가 본인과 다르면 실제 계약자 이름으로 수정해 주세요.</div>' : ''}
    <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
    <label>카마스터 연락처</label>
    <input id="rq-km-phone" type="tel" placeholder="계약한 카마스터의 연락처 (010-1234-5678)" autocomplete="off">
    <div class="hint" id="rq-km-hint"></div>
    <div style="margin-top:2px;"><a href="javascript:void(0)" onclick="goto('karmasters')" style="font-size:12px;color:#888;">연락처를 모르거나 카마스터를 아직 못 정했다면 → 카마스터 찾기</a></div>
    <label style="margin-top:16px;">차량 모델</label>
    <input id="rq-car" type="text" placeholder="예: 쏘렌토 하이브리드" autocomplete="off">
    <label>트림 / 옵션</label>
    <input id="rq-trim" type="text" placeholder="예: 시그니처, 선루프" autocomplete="off">
    <label>색상</label>
    <input id="rq-color" type="text" placeholder="예: 스노우 펄" autocomplete="off">
    <label>계약일자</label>
    <input id="rq-date" type="date" autocomplete="off">
    <label style="margin-top:16px;">내 연락처</label>
    <input id="rq-phone" type="tel" placeholder="010-1234-5678" autocomplete="off">
    <label>동호회 닉네임 (선택)</label>
    <input id="rq-nick" type="text" placeholder="예: 차박러123" autocomplete="off">
    <button class="btn btn-primary btn-auto" id="rq-submit" style="margin-top:14px;" disabled>계약내역 등록하기</button>
    <div class="hint" id="rq-hint" style="margin-top:8px;"></div>
    <button class="btn btn-outline btn-auto" style="margin-top:8px;" onclick="goto('landing')">← 처음으로</button>
  </div>`);
  const kmPhoneEl = wrap.querySelector('#rq-km-phone'), kmHintEl = wrap.querySelector('#rq-km-hint');
  const carEl = wrap.querySelector('#rq-car'), brandEl = wrap.querySelector('#rq-brand'), contractNoEl = wrap.querySelector('#rq-contract-no'), trimEl = wrap.querySelector('#rq-trim'), colorEl = wrap.querySelector('#rq-color'), dateEl = wrap.querySelector('#rq-date');
  const nameEl = wrap.querySelector('#rq-name'), phoneEl = wrap.querySelector('#rq-phone'), nickEl = wrap.querySelector('#rq-nick');
  const submitBtn = wrap.querySelector('#rq-submit'), hintEl = wrap.querySelector('#rq-hint');
  nameEl.value = requestDraft.name; phoneEl.value = requestDraft.phone; nickEl.value = requestDraft.nickname; kmPhoneEl.value = requestDraft.karmasterPhone || '';
  carEl.value = requestDraft.carModel; brandEl.value = requestDraft.carBrand; contractNoEl.value = requestDraft.contractNumber; trimEl.value = requestDraft.trim; colorEl.value = requestDraft.color; dateEl.value = requestDraft.contractDate;
  wrap.querySelector('#rq-sample-fill').addEventListener('click', () => {
    // 값 전부를 한눈에 "샘플/테스트"임을 알 수 있게 채운다 — 카마스터 연락처만 예외로, 시연이 바로
    // 이어지도록 씨드 카마스터(김도현) 번호를 쓴다.
    requestDraft = {
      karmasterPhone: '010-2222-3301',
      carModel: '테스트카', carBrand: '기타', contractNumber: 'SAMPLE-' + Math.floor(1000 + Math.random() * 9000),
      trim: '테스트트림', color: '테스트색상', contractDate: new Date().toISOString().slice(0, 10),
      name: '테스트고객', phone: '010-0000-0000', nickname: '테스트닉네임',
    };
    render();
  });

  function phoneFormat(el) {
    const f = formatPhoneDigits(el.value);
    if (el.value !== f) el.value = f;
    return f;
  }
  function validate() {
    const missing = [];
    if (!requestDraft.carBrand) missing.push('제조사');
    if (!requestDraft.contractNumber.trim()) missing.push('제조사 계약번호');
    if (requestDraft.name.trim().length < 2) missing.push('계약자명(2자 이상)');
    if (!/^010-?\d{3,4}-?\d{4}$/.test(requestDraft.karmasterPhone || '')) missing.push('카마스터 연락처');
    if (requestDraft.carModel.trim().length < 2) missing.push('차량 모델');
    if (!requestDraft.contractDate) missing.push('계약일자');
    if (!/^010-?\d{3,4}-?\d{4}$/.test(requestDraft.phone)) missing.push('내 연락처(010-0000-0000 형식)');
    submitBtn.disabled = missing.length > 0;
    hintEl.textContent = missing.length > 0 ? `다음 항목을 확인해주세요: ${missing.join(', ')}` : '';
    const km = Store.getKarmasterByPhone(requestDraft.karmasterPhone || '');
    kmHintEl.textContent = requestDraft.karmasterPhone && requestDraft.karmasterPhone.length >= 12
      ? (km ? `등록된 카마스터입니다: ${karmasterDisplayName(km)} — 승인 요청이 바로 전달됩니다.` : '아직 등록되지 않은 카마스터입니다 — 조회번호로 신규 등록됩니다.')
      : '';
  }
  kmPhoneEl.addEventListener('input', () => { requestDraft.karmasterPhone = phoneFormat(kmPhoneEl); validate(); });
  carEl.addEventListener('input', () => { requestDraft.carModel = carEl.value; validate(); });
  brandEl.addEventListener('change', () => { requestDraft.carBrand = brandEl.value; validate(); });
  contractNoEl.addEventListener('input', () => { requestDraft.contractNumber = contractNoEl.value; validate(); });
  trimEl.addEventListener('input', () => { requestDraft.trim = trimEl.value; });
  colorEl.addEventListener('input', () => { requestDraft.color = colorEl.value; });
  dateEl.addEventListener('change', () => { requestDraft.contractDate = dateEl.value; validate(); });
  nameEl.addEventListener('input', () => { requestDraft.name = nameEl.value; validate(); });
  phoneEl.addEventListener('input', () => { requestDraft.phone = phoneFormat(phoneEl); validate(); });
  nickEl.addEventListener('input', () => { requestDraft.nickname = nickEl.value; });
  validate();
  submitBtn.addEventListener('click', () => {
    const r = Store.startContractRequest({
      karmasterPhone: requestDraft.karmasterPhone,
      carModel: requestDraft.carModel.trim(), carBrand: requestDraft.carBrand, contractNumber: requestDraft.contractNumber.trim(), trim: requestDraft.trim.trim(), color: requestDraft.color.trim(), contractDate: requestDraft.contractDate,
      customer: { name: requestDraft.name.trim(), phone: requestDraft.phone, nickname: requestDraft.nickname.trim() },
    });
    requestDraft = { karmasterPhone: '', carModel: '', carBrand: '', contractNumber: '', trim: '', color: '', contractDate: '', name: loggedInName, phone: loggedInPhone, nickname: '' };
    activeId = r.id;
    goto('detail');
  });
  return wrap;
}
function copyConfirmCode(code) {
  navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
}

// ===================== 신차인도서비스 상세 화면 (단계별 분기) =====================
let _transitTicker = null;
function stopTransitTicker() { if (_transitTicker) { clearInterval(_transitTicker); _transitTicker = null; } }

function computePhase(r) {
  if (r.stage === 'EXCEPTION') return 'exception';
  // 카마스터 지정업체(A-경로)로 향하는 1차 구간은 고객에게 어느 업체인지, 실시간 배송 상세를 노출하지
  // 않는다 — 카마스터-업체 간 별개 거래이기 때문이다(shop_transit). 최종 목적지로 가는 구간(2차 구간,
  // 또는 A-경로가 아닌 일반 구간)만 실시간 배송 현황(transit)을 보여준다.
  if (r.transit && r.transit.active) return r.transit.legKind === 'to_shop' ? 'shop_transit' : 'transit';
  if (r.stage === '고객요청') return 'request_pending';
  if (r.stage === '계약등록') return 'contract_pending';
  if (r.stage === '계약확정') return 'release_prep';
  if (r.stage === 'CUSTOMIZING') return 'shop_progress';
  if (r.stage === 'DELIVERED') return 'delivery_confirm';
  if (r.stage === 'CONFIRMED') return 'delivery_done';
  return 'contract_pending';
}

// 출고 요청 전이면 최종 수령지 입력 + 요청 버튼을, 이미 요청했다면 그 수령지와 함께 대기 안내를 보여준다.
// 신차 케어 서비스 진행 상태와는 무관하게 항상 같은 UI를 쓴다 — 최종 수령지는 그 서비스의 완료 여부가
// 아니라 고객이 출고 요청 시점에 무엇을 입력했는지로만 정해진다.
function renderReleaseBox(r, placeholder) {
  if (r.ownerReleaseRequested) {
    return el(`<div class="hint">출고를 요청하셨습니다${r.deliveryAddress ? ` — 최종 수령지: <b>${r.deliveryAddress}</b>` : ''}. 카마스터가 확인 후 공장에 출고를 의뢰하면 배송이 시작됩니다.</div>`);
  }
  // 최종 수령지는 CUSTOM_ADDRESS일 때만 실제로 매번 달라진다 — DEALERSHIP/AFFILIATED_SHOP(제휴
  // 시공소를 거치더라도 최종적으로는 영업소로 돌아온다는 게 현재 기준, 추후 조정 가능)은 "영업소"가
  // 사실상 정답이라 기본값으로 미리 채워둔다. 그래도 고객이 원하면 언제든 직접 수정할 수 있다.
  if (!releaseAddrDraft && r.destinationType !== 'CUSTOM_ADDRESS') releaseAddrDraft = '영업소';
  const box = el(`<div>
    <label style="margin-top:12px;">최종 수령지</label>
    <input id="rel-addr" type="text" placeholder="${placeholder}" autocomplete="off">
    <div class="hint">출고 전까지는 언제든 바꿀 수 있습니다.</div>
    <button class="btn btn-primary btn-auto" id="rel-submit" style="margin-top:8px;" disabled>차량 출고 요청하기</button>
  </div>`);
  const addrEl = box.querySelector('#rel-addr'), btn = box.querySelector('#rel-submit');
  addrEl.value = releaseAddrDraft;
  btn.disabled = !releaseAddrDraft.trim();
  addrEl.addEventListener('input', () => { releaseAddrDraft = addrEl.value; btn.disabled = !addrEl.value.trim(); });
  btn.addEventListener('click', () => {
    Store.requestOwnerRelease(r.id, addrEl.value.trim());
    releaseAddrDraft = '';
    render();
  });
  return box;
}

function renderDetail() {
  stopTransitTicker();
  const r = Store.getReservation(activeId);
  if (!r) return el(`<div class="empty-state"><div class="big">🔍</div>계약 정보를 찾을 수 없습니다.<br><button class="btn btn-outline" style="width:auto;margin-top:14px;padding:10px 20px;" onclick="goto('landing')">처음으로</button></div>`);
  const km = Store.getKarmaster(r.karmasterId);

  const renderers = {
    request_pending: () => {
      if (km) {
        return el(`<div style="max-width:480px;">
          <h2>계약내역이 등록되었습니다</h2>
          <span class="badge wait">카마스터 승인 대기 · ${r.id}</span>
          ${renderPreReleaseStepperHTML(r)}
          <div class="msg-box"><b>${karmasterDisplayName(km)}</b>님의 화면에 등록하신 계약 내용이 바로 전달되었습니다. 카마스터가 내용을 검토하고 승인하면 다음 단계로 진행됩니다. 별도로 전달하실 내용은 없습니다.</div>
        </div>`);
      }
      const box = el(`<div style="max-width:480px;">
        <h2>계약내역이 등록되었습니다</h2>
        <span class="badge wait">조회번호 전달 대기 · ${r.id}</span>
        ${renderPreReleaseStepperHTML(r)}
        <div class="msg-box">계약 내용은 이미 등록되어 카마스터가 접속하는 즉시 확인할 수 있습니다. 다만 입력하신 연락처는 아직 이 서비스에 등록되지 않은 카마스터라, 아래 조회번호만은 앱이 대신 전달하지 못합니다 — 문자·전화 등으로 직접 전달해 주세요(실제 서비스에서는 SMS로 자동 발송될 예정입니다). 카마스터가 이 번호로 처음 접속하면 계정이 자동으로 만들어지며 이 계약에 연결됩니다.</div>
        <div id="confirm-code-display" style="font-size:32px;font-weight:800;letter-spacing:6px;text-align:center;padding:22px;background:#f3f8fd;border-radius:10px;border:1.5px dashed #185fa5;">${r.confirmCode}</div>
        <button class="btn btn-outline btn-auto" id="copy-code-btn" style="margin-top:10px;">조회번호 복사하기</button>
        <div class="hint" id="copy-code-hint" style="margin-top:6px;"></div>
      </div>`);
      box.querySelector('#copy-code-btn').addEventListener('click', () => {
        copyConfirmCode(r.confirmCode);
        box.querySelector('#copy-code-hint').textContent = '클립보드에 복사되었습니다. 문자·전화 등으로 직접 전달해 주세요.';
      });
      return box;
    },

    contract_pending: () => el(`<div>
      <h2>카마스터가 승인한 계약 내용을 확인해 주세요</h2>
      <span class="badge wait">고객 확인 대기 · ${r.id}</span>
      ${renderPreReleaseStepperHTML(r)}
      <div class="msg-box">${karmasterDisplayName(km)}님이 등록하신 계약 내용을 검토하고 아래와 같이 승인했습니다.<br>
        제조사 계약번호: <b>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</b><br>
        차량: <b>${r.carModel}</b>${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}${r.contractDate ? `<br>계약일자: ${r.contractDate}` : ''}<br>
        목적지 유형: <b>${destinationTypeLabel(r.destinationType)}</b>
        ${r.consultMemo ? `<br>상담 메모: ${r.consultMemo}` : ''}</div>
      <button class="btn btn-primary btn-auto" onclick="doConfirmContract()">계약 내용 확인 →</button>
    </div>`),

    release_prep: () => {
      const box = el(`<div>
        <h2>계약이 확정되었습니다</h2>
        <span class="badge done">계약 확정${hasCustomizing(r) ? ' · 출고 후 시공예정' : ' · 시공 없이 순수 차량 구매'}</span>
        ${renderPreReleaseStepperHTML(r)}
        <div class="msg-box">
          제조사 계약번호: <b>${r.carBrand || '-'} · ${r.contractNumber || '미입력'}</b><br>
          차량: <b>${r.carModel}</b>${r.trim ? ` · ${r.trim}` : ''}${r.color ? ` · ${r.color}` : ''}${r.contractDate ? `<br>계약일자: ${r.contractDate}` : ''}<br>
          목적지 유형: <b>${destinationTypeLabel(r.destinationType)}</b>
          ${r.consultMemo ? `<br>상담 메모: ${r.consultMemo}` : ''}
        </div>
      </div>`);
      box.appendChild(renderReleaseBox(r, '예: 자택 주소, 또는 직접 이용하실 정비·시공업체 주소'));
      const careLink = el(`<div style="margin-top:18px;">
        <div class="hint">별도로 시공·정비가 필요하시면, 신차 케어 서비스에서 이 차량을 골라 신청할 수 있습니다 — 출고 후 시공예정 여부와는 무관한 별개 서비스입니다.</div>
        <button class="btn btn-outline btn-auto" style="margin-top:6px;" id="care-open">신차 케어 서비스로 이동</button>
      </div>`);
      careLink.querySelector('#care-open').addEventListener('click', () => { careSetupReservationId = r.id; goto('care_setup'); });
      box.appendChild(careLink);
      return box;
    },

    transit: () => renderTransit(r),

    // 출고 후 시공예정(A-경로) 건은 카마스터와 지정업체 간 별개 거래라, 그 구간의 실시간 배송 상세나
    // 업체명을 고객에게 노출하지 않는다 — 이동중/작업중 여부만 간단히 안내한다.
    shop_transit: () => el(`<div>
      <h2>차량이 출고되어 이동 중입니다</h2>
      <span class="badge wait">지정업체로 이동중</span>
      <div class="msg-box">차량이 공장에서 출고되어 카마스터가 지정한 업체로 이동하고 있습니다. 도착 후 작업이 진행되며, 완료되면 최종 목적지로 재배송됩니다. 이 단계에서 별도로 확인하실 내용은 없습니다.</div>
    </div>`),
    shop_progress: () => {
      const pub = Store.getAugmentation(r).published;
      return el(`<div>
      <h2>차량이 지정업체에서 작업 진행중입니다</h2>
      <span class="badge wait">카마스터 확인 대기</span>
      <div class="msg-box">${pub.customizingProgress || '차량이 카마스터가 지정한 업체에 도착해 작업이 진행되고 있습니다. 카마스터가 시공완료를 확인하면 최종 목적지로 재배송이 시작됩니다.'}</div>
      <h4 style="margin-top:14px;">현장 실시간 업로드 사진</h4>
      ${renderPhotoGalleryHTML(Store.getAugmentation(r).customizingPhotos)}
      <div class="hint" style="margin-top:10px;">이 시공은 카마스터와의 별도 옵션이며, 인도 후 신청하는 신차 케어 서비스와는 무관합니다.</div>
    </div>`);
    },

    delivery_confirm: () => renderDeliveryConfirm(r),

    exception: () => {
      const pub = Store.getAugmentation(r).published;
      const reasonText = pub.delayReasonCode
        ? `${delayReasonLabel(pub.delayReasonCode)}${pub.delayReasonNote ? ` — ${pub.delayReasonNote}` : ''}`
        : '카마스터가 지연 상황을 확인하고 있습니다. 사유가 확인되는 대로 이곳에 안내됩니다.';
      return el(`<div>
      <span class="badge warn">배송 지연/예외 상태</span>
      <h2>배송에 문제가 발생했습니다</h2>
      <div class="msg-box" style="border-left-color:#c22;">${reasonText}</div>
      <div class="hint">문의사항은 아래 메시지창으로 카마스터에게 바로 전달할 수 있습니다.</div>
    </div>`);
    },

    delivery_done: () => el(`<div style="max-width:520px;">
      <h2 style="color:#3b6d11;">신차인도서비스가 완료되었습니다</h2>
      <span class="badge done">인도 완료</span>
      <p style="font-size:13px;color:#444;line-height:1.7;">${karmasterDisplayName(km)} 카마스터와 함께한 차량 인도 과정이 마무리되었습니다.</p>
      ${r.karmasterRated
        ? `<span class="badge done">카마스터 평가 완료 · +${fmtPoint(r.karmasterPointsEarned)} 적립</span>`
        : `<button class="btn btn-primary btn-auto" onclick="goRate('karmaster','${r.karmasterId}','${r.id}')">카마스터 평가하고 포인트 받기</button>
           <div class="hint" style="margin-top:8px;">평가는 나중에 "내 계약 확인" 이력에서도 남길 수 있습니다.</div>`}
    </div>`),
  };

  const phase = computePhase(r);
  const wrap = el(`<div><div id="stepper-slot">${renderStatusStepperHTML(r)}</div><div id="phase-slot"></div></div>`);
  const slot = wrap.querySelector('#phase-slot');
  slot.appendChild((renderers[phase] || renderers['contract_pending'])());
  if (r.stage === 'CONFIRMED' && !r.karmasterRated && phase !== 'delivery_done') {
    slot.appendChild(el(`<div class="msg-box" style="border-left:3px solid #185fa5;margin-top:16px;">아직 카마스터를 평가하지 않으셨습니다.
      <button class="btn btn-sm" style="margin-left:8px;" onclick="goRate('karmaster','${r.karmasterId}','${r.id}')">평가하고 포인트 받기</button></div>`));
  }
  slot.appendChild(el(`<div class="admin-controls" style="margin-top:24px;"><h4>전체 처리 이력</h4>${renderHistoryLogHTML(r)}</div>`));
  slot.appendChild(renderMessagePanel(r, 'customer', km ? karmasterDisplayName(km) : '카마스터'));
  const back = el(`<div style="margin-top:24px;"><button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="goto('history')">내 계약 확인으로</button></div>`);
  wrap.appendChild(back);
  return wrap;
}

// 매니저가 게시한 ETA/위치 보정 코멘트를 보여주는 "핵심 현황 배너". 매니저가 아직 아무것도 게시하지
// 않았으면 빈 문자열을 돌려줘 화면에 아무것도 추가되지 않는다("확인 중"류 문구를 강제로 채우지 않는다).
function renderPublishedBannerHTML(r) {
  const pub = Store.getAugmentation(r).published;
  if (!pub.eta && !pub.locationNote) return '';
  return `<div class="msg-box" style="margin-top:10px;">
    ${pub.eta ? `<div><b>도착 예정</b>: ${pub.eta.replace('T', ' ')}</div>` : ''}
    ${pub.locationNote ? `<div>${pub.locationNote}</div>` : ''}
  </div>`;
}
function renderPhotoGalleryHTML(photos) {
  const live = (photos || []).filter(p => !p.withdrawn);
  if (!live.length) return `<div class="hint">아직 업로드된 사진이 없습니다.</div>`;
  return `<div class="photo-row">${live.map(p => `<img src="${p.src}" alt="${p.label}" style="flex:1;height:100px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`).join('')}</div>`;
}

// ===================== DELIVERED: 검수/전자서명 (ui-items-spec.md 1.2절) =====================
// 서명 캔버스는 Store가 아니라 화면에만 존재하는 상태다 — 폴링 재렌더가 도중에 한 번 더 일어나도(예:
// 다른 창에서 카마스터가 같은 건을 개인수령확인 처리) 그려둔 서명이 지워지지 않도록, 예약번호별
// dataURL 캐시를 따로 들고 있다가 캔버스가 다시 그려질 때 그 위에 복원한다.
let inspectionDrafts = {}; // id -> { result, note, photos: [{src,label}] }
let signatureCache = {}; // id -> dataURL (제출 전까지만 유지, 제출 후 비움)
function getInspectionDraft(id) {
  if (!inspectionDrafts[id]) inspectionDrafts[id] = { result: null, note: '', photos: [] };
  return inspectionDrafts[id];
}

function attachSignaturePad(canvas, id, onStrokeChange) {
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let drawing = false;
  if (signatureCache[id]) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = signatureCache[id];
  }
  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches && e.touches.length ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }
  function start(e) { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
  function move(e) {
    if (!drawing) return;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    signatureCache[id] = canvas.toDataURL('image/png');
    onStrokeChange(true);
    e.preventDefault();
  }
  function end() { drawing = false; }
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); delete signatureCache[id]; onStrokeChange(false); },
  };
}

function renderDeliveryConfirm(r) {
  const pub = Store.getAugmentation(r).published;
  const photoSection = `<h4>인수 사진</h4>${renderPhotoGalleryHTML(Store.getAugmentation(r).deliveryPhotos)}${pub.locationNote ? `<div class="hint" style="margin-top:8px;">${pub.locationNote}</div>` : ''}`;

  if (r.isCustomerApproved) {
    return el(`<div>
      <h2>차량이 안전하게 도착했습니다</h2>
      <div class="sub">외관을 확인해 주세요${r.deliveredAt ? ` · 인수 완료 시각: ${fmtTime(r.deliveredAt)}` : ''}</div>
      <div class="hint" style="margin:10px 0;">카마스터 개인수령확인: <span class="badge ${r.isManagerConfirmed ? 'done' : 'wait'}">${r.isManagerConfirmed ? '완료' : '대기중'}</span></div>
      ${photoSection}
      <div class="msg-box" style="margin-top:14px;">고객님의 최종인수승인이 접수되었습니다 (검수: ${r.inspectionResult === 'issue' ? '이슈 발견' : '이상없음'}${r.inspectionNote ? ` — ${r.inspectionNote}` : ''}). 카마스터 개인수령확인이 끝나면 신차인도서비스가 종료됩니다.</div>
      ${r.signature ? `<img src="${r.signature}" alt="전자서명" style="border:1px solid #ddd;border-radius:8px;max-width:280px;margin-top:8px;display:block;">` : ''}
    </div>`);
  }

  const d = getInspectionDraft(r.id);
  const wrap = el(`<div>
    <h2>차량이 안전하게 도착했습니다</h2>
    <div class="sub">외관을 확인해 주세요${r.deliveredAt ? ` · 인수 완료 시각: ${fmtTime(r.deliveredAt)}` : ''}</div>
    <div class="hint" style="margin:10px 0;">카마스터 개인수령확인: <span class="badge ${r.isManagerConfirmed ? 'done' : 'wait'}">${r.isManagerConfirmed ? '완료' : '대기중'}</span></div>
    ${photoSection}

    <h4 style="margin-top:18px;">검수 결과</h4>
    <div class="btn-row" style="margin-top:0;">
      <button class="btn btn-sm" id="insp-ok">이상없음</button>
      <button class="btn btn-sm" id="insp-issue">이슈 발견</button>
    </div>
    <div class="hint" id="insp-status"></div>
    <div id="insp-note-wrap" style="display:none;">
      <label>특이사항 메모 (최대 500자)</label>
      <textarea id="insp-note" rows="3" maxlength="500" placeholder="예: 우측 앞 범퍼 스크래치 발견"></textarea>
      <label>사진 첨부 (선택, 이슈 근거자료)</label>
      <div id="insp-photos" class="photo-row" style="margin-bottom:8px;"></div>
      <div class="btn-row" style="margin-top:0;">
        <button class="btn btn-sm" id="insp-photo-sample">샘플 이미지 추가</button>
        <label class="btn btn-sm" style="cursor:pointer;">파일 선택 업로드<input type="file" id="insp-photo-file" accept="image/*" style="display:none;"></label>
      </div>
    </div>

    <h4 style="margin-top:18px;">전자서명</h4>
    <div class="hint" style="margin-bottom:6px;">아래 칸에 마우스(또는 터치)로 서명해 주세요.</div>
    <canvas id="insp-sig" width="360" height="140" style="border:1px solid #ccc;border-radius:8px;background:#fff;touch-action:none;max-width:100%;display:block;"></canvas>
    <button class="btn btn-outline btn-sm" id="insp-sig-clear" style="margin-top:6px;">서명 지우기</button>

    <button class="btn btn-primary btn-auto" id="insp-submit" style="margin-top:16px;" disabled>인수 확인</button>
  </div>`);

  const statusEl = wrap.querySelector('#insp-status'), noteWrap = wrap.querySelector('#insp-note-wrap'), noteEl = wrap.querySelector('#insp-note');
  const photosBox = wrap.querySelector('#insp-photos'), submitBtn = wrap.querySelector('#insp-submit');
  noteEl.value = d.note;
  let hasSignature = !!signatureCache[r.id];

  function renderPhotoThumbs() {
    photosBox.innerHTML = '';
    d.photos.forEach((p) => photosBox.appendChild(el(`<img src="${p.src}" alt="${p.label}" style="flex:1;height:80px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`)));
  }
  renderPhotoThumbs();

  function refreshStatus() {
    statusEl.textContent = d.result === null ? '선택되지 않음' : (d.result === 'issue' ? '이슈 발견으로 선택됨' : '이상없음으로 선택됨');
    noteWrap.style.display = d.result === 'issue' ? '' : 'none';
  }
  function validate() {
    const noteOk = d.result !== 'issue' || d.note.trim().length > 0;
    submitBtn.disabled = !(d.result !== null && noteOk && hasSignature);
  }
  refreshStatus(); validate();

  wrap.querySelector('#insp-ok').addEventListener('click', () => { d.result = 'ok'; refreshStatus(); validate(); });
  wrap.querySelector('#insp-issue').addEventListener('click', () => { d.result = 'issue'; refreshStatus(); validate(); });
  noteEl.addEventListener('input', () => { d.note = noteEl.value; validate(); });
  wrap.querySelector('#insp-photo-sample').addEventListener('click', () => {
    if (d.photos.length >= 6) return;
    d.photos.push({ src: generateSamplePhoto(d.photos.length, `검수 사진 ${d.photos.length + 1}`), label: `검수 사진 ${d.photos.length + 1}` });
    renderPhotoThumbs();
  });
  const fileInput = wrap.querySelector('#insp-photo-file');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !file.type.startsWith('image/') || d.photos.length >= 6) return;
    const reader = new FileReader();
    reader.onload = () => { d.photos.push({ src: reader.result, label: file.name }); renderPhotoThumbs(); };
    reader.readAsDataURL(file);
  });

  const sigCanvas = wrap.querySelector('#insp-sig');
  const pad = attachSignaturePad(sigCanvas, r.id, (has) => { hasSignature = has; validate(); });
  wrap.querySelector('#insp-sig-clear').addEventListener('click', () => pad.clear());

  submitBtn.addEventListener('click', () => {
    const updated = Store.submitCustomerInspection(r.id, {
      inspectionResult: d.result, inspectionNote: d.note, photos: d.photos, signature: signatureCache[r.id],
    });
    if (updated && updated.isCustomerApproved) {
      delete inspectionDrafts[r.id];
      delete signatureCache[r.id];
    }
    render();
  });

  return wrap;
}

function renderTransit(r) {
  const tp = transitProgress(r);
  const box = el(`<div>
    <h2>실시간 배송 현황</h2>
    <div class="sub">배송 (고객 지정 수령지로) · 목적지: ${tp.destination}</div>
    <div class="summary-line"><span>담당 배송기사</span><span id="driver-name-el">${tp.driverName}</span></div>
    <div id="dstepper-slot">${renderDeliveryStepperHTML(r)}</div>
    <div class="hint" id="transit-hint-el" style="margin-top:8px;">다음 위치까지 약 ${tp.remainSec}초 남음 (데모 시뮬레이션)</div>
    ${renderPublishedBannerHTML(r)}
  </div>`);
  _transitTicker = setInterval(() => {
    const cur = Store.getReservation(activeId);
    if (!cur || !cur.transit || !cur.transit.active) { stopTransitTicker(); render(); return; }
    const p = transitProgress(cur);
    const hintEl = document.getElementById('transit-hint-el');
    const stepSlot = document.getElementById('dstepper-slot');
    if (!hintEl || !stepSlot) { stopTransitTicker(); return; }
    hintEl.textContent = `다음 위치까지 약 ${p.remainSec}초 남음 (데모 시뮬레이션)`;
    stepSlot.innerHTML = renderDeliveryStepperHTML(cur);
  }, 300);
  return box;
}

let msgDraft = '';
function renderMessagePanel(r, myRole, counterpartLabel) {
  const msgs = r.messages || [];
  const box = el(`<div class="admin-controls" style="margin-top:24px;">
    <h4>${counterpartLabel}에게 메시지</h4>
    <div class="msg-thread" id="msg-thread"></div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <input id="msg-input" type="text" placeholder="문의사항을 입력하세요" style="flex:1;">
      <button class="btn btn-primary btn-sm" id="msg-send" style="width:auto;padding:10px 18px;">보내기</button>
    </div>
  </div>`);
  const thread = box.querySelector('#msg-thread');
  if (msgs.length === 0) {
    thread.appendChild(el(`<div class="hint">아직 주고받은 메시지가 없습니다.</div>`));
  } else {
    msgs.forEach(m => {
      const mine = m.from === 'customer';
      thread.appendChild(el(`<div class="msg-bubble ${mine ? 'mine' : 'theirs'}"><div class="msg-meta">${mine ? '나' : counterpartLabel} · ${fmtTime(m.t)}</div><div>${m.text}</div></div>`));
    });
  }
  const input = box.querySelector('#msg-input');
  input.value = msgDraft;
  input.addEventListener('input', () => { msgDraft = input.value; });
  box.querySelector('#msg-send').addEventListener('click', () => {
    if (!input.value.trim()) return;
    Store.sendMessage(r.id, 'customer', input.value);
    msgDraft = '';
    render();
  });
  return box;
}

// ===================== 계약 확인 =====================
function doConfirmContract() { Store.confirmContractByCustomer(activeId); render(); }

// ===================== 신차 케어 서비스 (신차인도서비스와 완전히 독립) =====================
// "내 차량"(=신차인도서비스로 등록한 예약) 목록에서 하나를 골라 신청한다. 출고 전이든 이미 받은
// 차든 상관없다 — 신청 시점에 차량·고객 정보를 그대로 복사해오는 완전히 독립된 계약이다.
function renderCare() {
  const myCars = loggedInPhone ? Store.getReservationsByPhone(loggedInPhone) : [];
  const list = loggedInPhone ? Store.getCareOrdersByPhone(loggedInPhone) : [];
  const wrap = el(`<div>
    <h2>신차 케어 서비스</h2>
    <div class="sub">신차인도서비스와 시간적으로 완전히 분리된 독립 서비스입니다. 내 차량 중 하나를 골라 시공사를 검색·선택하고 견적을 요청하세요.</div>
    ${myCars.length === 0
      ? `<div class="hint">아직 등록된 내 차량이 없습니다. 먼저 "계약내역 등록하기"로 신차인도서비스 계약을 등록해야 신청할 수 있습니다.</div>`
      : `<button class="btn btn-primary btn-auto" id="care-new">새로 신청하기</button>`}
    <h3 style="margin-top:24px;">내 신청 내역</h3>
    <div id="care-list"></div>
    <div style="margin-top:20px;"><button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="goto('landing')">← 처음으로</button></div>
  </div>`);
  const newBtn = wrap.querySelector('#care-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    careSetupReservationId = myCars.length === 1 ? myCars[0].id : null;
    goto('care_setup');
  });
  const listBox = wrap.querySelector('#care-list');
  if (list.length === 0) {
    listBox.appendChild(el(`<div class="hint">아직 신청한 신차 케어 서비스가 없습니다.</div>`));
  } else {
    const table = el(`<table><tr><th>계약번호</th><th>차종</th><th>시공사</th><th>상태</th><th>평가</th></tr></table>`);
    list.forEach(c => {
      const shop = Store.getShop(c.shopId);
      const needsRate = c.status === '수령확인' && c.priceMatch !== null && c.priceMatch !== undefined && !c.disputed && !c.shopRated;
      const tr = elRow(`<tr class="clickable"><td>${c.id}</td><td>${c.carModel || '-'}</td><td>${shop ? shop.name : '-'}</td>
        <td><span class="badge ${amBadgeClass(c.status)}">${c.status}</span></td><td>${needsRate ? '<span class="badge wait">평가대기</span>' : '-'}</td></tr>`);
      tr.addEventListener('click', () => { careActiveId = c.id; goto('care_detail'); });
      table.appendChild(tr);
    });
    listBox.appendChild(table);
  }
  return wrap;
}

// 신청 첫 단계: "내 차량" 중 어느 차량에 대한 신청인지 고른다(차가 1대뿐이면 자동 선택).
// 다른 화면(신차인도서비스 상세)에서 특정 차량을 미리 골라 들어온 경우 이 단계를 건너뛴다.
function renderCareSetup() {
  const myCars = loggedInPhone ? Store.getReservationsByPhone(loggedInPhone) : [];
  if (!careSetupReservationId) {
    const wrap = el(`<div style="max-width:520px;">
      <h2>어느 차량에 대한 신청인가요?</h2>
      <div class="sub">출고 전이든 이미 받은 차든 상관없습니다.</div>
      <div id="car-pick-list" class="shop-grid"></div>
      <button class="btn btn-outline btn-auto" style="margin-top:16px;" onclick="goto('care')">← 취소</button>
    </div>`);
    const box = wrap.querySelector('#car-pick-list');
    myCars.forEach(r => {
      const card = el(`<div class="shop-card"><div class="name">${r.carModel || '차종 미정'}${r.trim ? ' · ' + r.trim : ''}</div><div class="rating">${r.id} · ${r.stage}</div></div>`);
      card.addEventListener('click', () => { careSetupReservationId = r.id; render(); });
      box.appendChild(card);
    });
    return wrap;
  }
  const source = Store.getReservation(careSetupReservationId);
  if (!source) { careSetupReservationId = null; return renderCareSetup(); }
  return renderAmSetup(source);
}

function renderAmSetup(source) {
  const shopCards = Store.getApprovedShops().map(s => {
    const rt = Store.getRatingsFor('shop', s.id);
    const sel = amDraft.shopId === s.id;
    return `<div class="shop-card ${sel ? 'sel' : ''}" onclick="selectAmShop('${s.id}')">
      ${sel ? '<span class="badge done" style="margin-bottom:6px;">✓ 선택됨</span>' : ''}
      <div class="name">${s.name}</div>
      <div class="rating">${fmtStars(rt.overall !== null ? rt.overall : s.rating)} · ${rt.count > 0 ? `앱 내 평가 ${rt.count}건` : `초기 평점 ${s.reviews}건`}</div>
      <div>${s.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
    </div>`;
  }).join('');
  const pkg = PACKAGES.find(p => p.id === amDraft.packageId);
  const selectedOptions = OPTION_CATALOG.filter(o => amDraft.optionIds.includes(o.id));
  const suggested = pkg.price + selectedOptions.reduce((s, o) => s + o.price, 0);

  const wrap = el(`<div>
    <h2>신차 케어 서비스 신청</h2>
    <div class="sub">대상 차량: <b>${source.carModel || '차종 미정'}</b>${source.trim ? ` · ${source.trim}` : ''} (${source.id}). 시공사를 선택하고 옵션을 구성하면, 시공사가 요청사항을 반영해 최종 견적을 회신합니다.</div>
    <h3>시공사 선택</h3>
    <div class="shop-grid">${shopCards}</div>

    <h3 style="margin-top:18px;">기본 패키지</h3>
    <div class="pkg-row">${PACKAGES.map(p => `<div class="pkg-card ${amDraft.packageId === p.id ? 'sel' : ''}" onclick="selectAmPackage('${p.id}')"><div class="name">${p.name}</div><div class="price">${(p.price / 10000).toLocaleString()}만원</div><div class="desc">${p.desc}</div></div>`).join('')}</div>

    <h3>추가옵션 (선택)</h3>
    <div id="am-options"></div>

    <h3>진행 방식</h3>
    <div class="path-tabs">
      <div class="path-tab ${amDraft.mode === 'online' ? 'active' : ''}" onclick="setAmMode('online')">온라인 즉시견적</div>
      <div class="path-tab ${amDraft.mode === 'visit' ? 'active' : ''}" onclick="setAmMode('visit')">방문 후 협의</div>
    </div>

    <h3>요청사항 (선택)</h3>
    <textarea id="am-request" rows="3" placeholder="예: 도어 하부 PPF 추가 부탁드립니다"></textarea>

    <div class="summary-line" style="margin-top:14px;"><span>참고 견적(기본+옵션 합)</span><span id="am-suggested">${fmtMoney(suggested)}</span></div>
    <div class="hint">실제 견적은 시공사가 요청사항까지 반영해 별도로 회신합니다.</div>
    <button class="btn btn-primary btn-auto" id="am-submit" style="margin-top:14px;" ${!amDraft.shopId ? 'disabled' : ''}>견적 요청하기 →</button>
    <button class="btn btn-outline btn-auto" style="margin-top:8px;" onclick="goto('care')">← 취소</button>
  </div>`);

  const optionsBox = wrap.querySelector('#am-options');
  OPTION_CATALOG.forEach(o => {
    const row = el(`<div class="opt-row"><span>${o.name} · ${fmtMoney(o.price)}</span><input type="checkbox" id="opt-${o.id}" ${amDraft.optionIds.includes(o.id) ? 'checked' : ''}></div>`);
    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) amDraft.optionIds.push(o.id);
      else amDraft.optionIds = amDraft.optionIds.filter(id => id !== o.id);
      refreshSuggested();
    });
    optionsBox.appendChild(row);
  });
  function refreshSuggested() {
    const p = PACKAGES.find(pp => pp.id === amDraft.packageId);
    const opts = OPTION_CATALOG.filter(o => amDraft.optionIds.includes(o.id));
    wrap.querySelector('#am-suggested').textContent = fmtMoney(p.price + opts.reduce((s, o) => s + o.price, 0));
  }
  const reqEl = wrap.querySelector('#am-request');
  reqEl.value = amDraft.customRequest;
  reqEl.addEventListener('input', () => { amDraft.customRequest = reqEl.value; });
  wrap.querySelector('#am-submit').addEventListener('click', submitAmRequest);
  return wrap;
}
function selectAmShop(id) { amDraft.shopId = id; render(); }
function selectAmPackage(id) { amDraft.packageId = id; render(); }
function setAmMode(m) { amDraft.mode = m; render(); }
function submitAmRequest() {
  const order = Store.requestCareOrder({
    reservationId: careSetupReservationId,
    shopId: amDraft.shopId, mode: amDraft.mode, packageId: amDraft.packageId,
    optionIds: amDraft.optionIds, customRequest: amDraft.customRequest,
  });
  amDraft = { shopId: null, packageId: PACKAGES[1].id, optionIds: [], mode: 'online', customRequest: '', pointsUsed: 0 };
  careSetupReservationId = null;
  careActiveId = order.id;
  goto('care_detail');
}

// ===================== 신차 케어 서비스 상세 화면 (단계별 분기) =====================
function computeCarePhase(c) {
  if (c.transit && c.transit.active) return 'care_transit';
  if (c.status === 'requested') return 'care_requested';
  if (c.status === 'quoted') return 'care_quoted';
  if (c.status === 'confirmed') return 'care_confirmed';
  if (SHOP_STAGES.some(s => s.code === c.status)) return 'care_shop_progress';
  if (c.status === '고객검수대기') return 'care_inspect';
  if (c.status === '출차완료') return 'care_out';
  if (c.status === '수령대기') return 'care_receive';
  if (c.status === '수령확인') {
    if (c.priceMatch === null || c.priceMatch === undefined) return 'care_pricecheck';
    if (c.disputed) return 'care_disputed';
    if (!c.shopRated) return 'care_rate';
    return 'care_done';
  }
  return 'care_requested';
}

function renderCareDetail() {
  stopTransitTicker();
  const c = Store.getCareOrder(careActiveId);
  if (!c) return el(`<div class="empty-state"><div class="big">🔍</div>신청 내역을 찾을 수 없습니다.<br><button class="btn btn-outline" style="width:auto;margin-top:14px;padding:10px 20px;" onclick="goto('care')">신차 케어 서비스로</button></div>`);
  const shop = Store.getShop(c.shopId);

  const renderers = {
    care_requested: () => el(`<div>
      <h2>시공사 견적 대기중</h2>
      <span class="badge wait">${shop.name} 견적 확인중</span>
      <div class="msg-box">${c.mode === 'online' ? '온라인으로 요청한 견적을' : '방문 협의 후 견적을'} 시공사가 확인하고 있습니다. 견적이 도착하면 알려드립니다.</div>
    </div>`),
    care_quoted: () => renderCareQuoted(c),
    care_confirmed: () => el(`<div>
      <h2>신차 케어 서비스 계약이 완료되었습니다</h2>
      <span class="badge done">${shop.name} · 계약 완료</span>
      <div class="msg-box">차량을 시공사에 입고해 주세요. 시공사가 입고를 확인하면 작업이 시작됩니다.</div>
    </div>`),
    care_shop_progress: () => renderCareShopTimeline(c),
    care_inspect: () => renderCareInspect(c),
    care_out: () => el(`<div>
      <h2>출차 완료 — 배송 대기중</h2>
      <div class="msg-box">시공업체에서 차량이 출차했습니다. 잠시 후 오너에게 배송이 시작됩니다.</div>
    </div>`),
    care_transit: () => renderCareTransit(c),
    care_receive: () => el(`<div>
      <h2>차량이 도착했습니다</h2>
      <div class="msg-box">시공이 완료된 차량이 도착했습니다. 최종 수령을 확인해 주세요.</div>
      <button class="btn btn-primary btn-auto" onclick="ownerConfirmCare()">차량 수령 확인하기</button>
    </div>`),
    care_pricecheck: () => el(`<div class="row">
      <div class="col-l">
        <h2>정찰제 이행 확인</h2>
        <div class="check-q">사전에 확정했던 <b>${fmtMoney(c.quotedPrice)}</b> 외에 현장에서 추가 요금을 요구받으셨나요?</div>
        <button class="btn btn-primary" style="margin-bottom:10px;" onclick="answerCarePriceCheck(true)">아니오, 견적가 그대로였습니다</button>
        <button class="btn btn-danger" onclick="answerCarePriceCheck(false)">예, 추가금을 요구받았습니다</button>
      </div>
      <div class="col-r">
        <div class="summary-card">
          <div class="summary-title">참고 정보</div>
          <div class="summary-line"><span>사전 견적가</span><span>${fmtMoney(c.quotedPrice)}</span></div>
          <div class="summary-line"><span>실제 청구액</span><span>${c.chargedPrice ? fmtMoney(c.chargedPrice) : '미입력'}</span></div>
          ${c.chargeNote ? `<div class="summary-line"><span>작업 내역</span><span>${c.chargeNote}</span></div>` : ''}
        </div>
      </div>
    </div>`),
    care_disputed: () => el(`<div style="max-width:520px;">
      <h2 style="color:#b4362e;">접수되었습니다</h2>
      <p style="font-size:13px;color:#444;line-height:1.7;">운영자에게 즉시 전달되었습니다. 빠른 시간 내에 연락드리겠습니다.</p>
    </div>`),
    care_rate: () => el(`<div style="max-width:520px;">
      <h2>정찰제 이행 확인됨</h2>
      <span class="badge done">일치 확인</span>
      <p style="font-size:13px;color:#444;line-height:1.7;">${shop.name}에 대한 평가를 남기면 포인트가 적립됩니다.</p>
      <button class="btn btn-primary btn-auto" onclick="goRate('shop','${c.shopId}','${c.id}')">시공사 평가하고 포인트 받기</button>
      <div class="hint" style="margin-top:8px;">평가는 나중에 "신차 케어 서비스" 목록에서도 남길 수 있습니다.</div>
    </div>`),
    care_done: () => el(`<div style="max-width:520px;">
      <h2 style="color:#3b6d11;">신차 케어 서비스가 완료되었습니다</h2>
      <span class="badge done">+${fmtPoint(c.shopPointsEarned)} 적립</span>
      <p style="font-size:13px;color:#444;line-height:1.7;">현재 보유 포인트: <b>${fmtPoint(Store.getPointBalance(c.customer.phone))}</b></p>
    </div>`),
  };

  const phase = computeCarePhase(c);
  const wrap = el(`<div><div id="phase-slot"></div></div>`);
  const slot = wrap.querySelector('#phase-slot');
  slot.appendChild((renderers[phase] || renderers['care_requested'])());
  slot.appendChild(el(`<div class="admin-controls" style="margin-top:24px;"><h4>전체 처리 이력</h4>${renderHistoryLogHTML(c)}</div>`));
  const back = el(`<div style="margin-top:24px;"><button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="goto('care')">신차 케어 서비스 목록으로</button></div>`);
  wrap.appendChild(back);
  return wrap;
}

function renderCareTransit(c) {
  const tp = transitProgress(c);
  const box = el(`<div>
    <h2>실시간 배송 현황</h2>
    <div class="sub">2차 배송 (시공 완료 → 고객 인도) · 목적지: 오너</div>
    <div class="summary-line"><span>담당 배송기사</span><span id="driver-name-el">${tp.driverName}</span></div>
    <div id="dstepper-slot">${renderDeliveryStepperHTML(c)}</div>
    <div class="hint" id="transit-hint-el" style="margin-top:8px;">다음 위치까지 약 ${tp.remainSec}초 남음 (데모 시뮬레이션)</div>
  </div>`);
  _transitTicker = setInterval(() => {
    const cur = Store.getCareOrder(careActiveId);
    if (!cur || !cur.transit || !cur.transit.active) { stopTransitTicker(); render(); return; }
    const p = transitProgress(cur);
    const hintEl = document.getElementById('transit-hint-el');
    const stepSlot = document.getElementById('dstepper-slot');
    if (!hintEl || !stepSlot) { stopTransitTicker(); return; }
    hintEl.textContent = `다음 위치까지 약 ${p.remainSec}초 남음 (데모 시뮬레이션)`;
    stepSlot.innerHTML = renderDeliveryStepperHTML(cur);
  }, 300);
  return box;
}

function renderCareShopTimeline(c) {
  const shop = Store.getShop(c.shopId);
  return el(`<div>
    <h2>${c.carModel || ''} 시공 진행 현황</h2>
    <div class="sub">시공업체: ${shop.name}</div>
    ${renderShopTimelineHTML(c)}
  </div>`);
}

function renderCareInspect(c) {
  const box = el(`<div>
    <h2>시공이 완료되었습니다 — 검수를 확인해 주세요</h2>
    <div class="msg-box">시공업체에서 최종 검수를 마쳤습니다. 아래 시공 결과(사진)를 확인하고, 만족스러우면 출차를 승인해 주세요.</div>
    ${renderShopTimelineHTML(c)}
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-primary btn-auto" onclick="ownerConfirmCare()">만족합니다, 출차 승인</button>
      <button class="btn btn-danger btn-auto" onclick="openCareDisputeBox()">불만족 — 재작업 요청</button>
    </div>
    <div id="dispute-box" style="display:none;margin-top:12px;">
      <textarea id="dispute-reason" rows="3" placeholder="불만족 사유를 입력해 주세요 (예: 틴팅 기포, 마감 스크래치 등)"></textarea>
      <button class="btn btn-danger btn-sm" style="margin-top:8px;" onclick="submitCareDispute()">이의제기 접수</button>
    </div>
    ${c.disputed ? `<div class="msg-box" style="margin-top:14px;border-left-color:#c22;">⚠ 이의제기가 접수되어 관리자가 확인 중입니다. 사유: ${c.disputeReason}</div>` : ''}
  </div>`);
  const disputeBox = box.querySelector('#dispute-box');
  window.openCareDisputeBox = () => { disputeBox.style.display = 'block'; };
  window.submitCareDispute = () => {
    const reason = box.querySelector('#dispute-reason').value;
    Store.raiseCareDispute(careActiveId, reason);
    render();
  };
  return box;
}
function ownerConfirmCare() { Store.ownerConfirmCare(careActiveId); render(); }
function answerCarePriceCheck(match) { Store.answerCarePriceCheck(careActiveId, match); render(); }

function renderCareQuoted(c) {
  const shop = Store.getShop(c.shopId);
  const balance = Store.getPointBalance(c.customer.phone);
  const cap = Math.min(balance, c.quotedPrice || 0);
  const wrap = el(`<div class="row">
    <div class="col-l">
      <h2>시공사 견적이 도착했습니다</h2>
      <span class="badge info">${shop.name}</span>
      <div class="msg-box">기본 패키지 ${c.package.name}${c.options.length ? ` + 추가옵션 ${c.options.map(o => o.name).join(', ')}` : ''}${c.customRequest ? `<br>요청사항: ${c.customRequest}` : ''}</div>
      <label>포인트 사용</label>
      <div class="hint" style="margin-bottom:8px;">보유 포인트: <b>${fmtPoint(balance)}</b></div>
      <input id="am-points-used" type="number" min="0" max="${cap}" step="1000" value="0" ${cap <= 0 ? 'disabled' : ''}>
      <button class="btn btn-primary btn-auto" style="margin-top:14px;" id="am-confirm">이 견적으로 계약 완료</button>
    </div>
    <div class="col-r">
      <div class="summary-card">
        <div class="summary-title">최종 견적</div>
        <div class="summary-total">${fmtMoney(c.quotedPrice)}</div>
      </div>
    </div>
  </div>`);
  wrap.querySelector('#am-confirm').addEventListener('click', () => {
    const used = parseInt(wrap.querySelector('#am-points-used').value, 10) || 0;
    Store.confirmCareQuote(careActiveId, used);
    render();
  });
  return wrap;
}

// ===================== 평가하기 (카마스터 = 신차인도서비스 예약 대상 / 시공사 = 신차 케어 서비스 주문 대상) =====================
function goRate(type, targetId, refId) {
  ratingTarget = { type, targetId, refId };
  ratingScores = {};
  Store.ratingDims(type).forEach(d => { ratingScores[d.id] = 5; });
  goto('rate');
}
function renderRating() {
  if (!ratingTarget) return el(`<div class="empty-state">평가할 대상이 없습니다. <button class="btn btn-outline" style="width:auto;margin-top:10px;" onclick="goto('history')">이력으로</button></div>`);
  const { type, targetId, refId } = ratingTarget;
  const dims = Store.ratingDims(type);
  const targetName = type === 'karmaster' ? karmasterDisplayName(Store.getKarmaster(targetId)) : Store.getShop(targetId).name;
  const wrap = el(`<div style="max-width:520px;">
    <h2>${targetName} 평가하기</h2>
    <div class="sub">평가를 제출하면 포인트가 즉시 적립됩니다. 지금 하지 않아도 나중에 이력에서 평가할 수 있습니다.</div>
    <div id="rating-dims"></div>
    <label>후기 (선택)</label>
    <textarea id="rating-comment" rows="3" placeholder="이용 경험을 남겨주세요"></textarea>
    <button class="btn btn-primary btn-auto" style="margin-top:14px;" id="rating-submit">평가 제출하고 포인트 받기</button>
  </div>`);
  const dimsBox = wrap.querySelector('#rating-dims');
  dims.forEach(d => {
    const row = el(`<div style="margin-bottom:16px;">
      <label style="margin-bottom:6px;">${d.label}</label>
      <input type="range" min="1" max="5" value="5" id="dim-${d.id}" style="width:100%;">
      <div class="hint" id="dim-${d.id}-val">5점</div>
    </div>`);
    const range = row.querySelector(`#dim-${d.id}`), valEl = row.querySelector(`#dim-${d.id}-val`);
    range.addEventListener('input', () => { ratingScores[d.id] = parseInt(range.value, 10); valEl.textContent = `${range.value}점`; });
    dimsBox.appendChild(row);
  });
  wrap.querySelector('#rating-submit').addEventListener('click', () => {
    const comment = wrap.querySelector('#rating-comment').value;
    Store.submitRating(type, targetId, refId, Object.assign({}, ratingScores), comment);
    ratingTarget = null;
    goto(type === 'karmaster' ? 'history' : 'care');
  });
  return wrap;
}

// ===================== 내 계약 확인 / 이력 (신차인도서비스) =====================
function renderHistory() {
  const wrap = el(`<div>
    <h2>내 계약 확인 / 이력 조회</h2>
    <div style="display:flex;gap:10px;max-width:420px;margin-bottom:14px;">
      <input id="hist-phone" type="tel" placeholder="010-1234-5678" value="${historyPhone}" autocomplete="off">
      <button class="btn btn-primary btn-auto" id="hist-search">조회</button>
    </div>
    <div id="hist-filter-row" style="display:none;max-width:420px;margin-bottom:24px;">
      <input id="hist-filter" type="text" placeholder="접수번호·제조사 계약번호·카마스터 이름·차종으로 좁혀보기" autocomplete="off">
    </div>
    <div id="hist-results"></div>
  </div>`);
  const input = wrap.querySelector('#hist-phone'), btn = wrap.querySelector('#hist-search'), resultsBox = wrap.querySelector('#hist-results');
  const filterRow = wrap.querySelector('#hist-filter-row'), filterInput = wrap.querySelector('#hist-filter');
  let currentList = [];

  // 필터 입력은 이 안에서만 결과 테이블을 다시 그린다(전체 화면 render()를 타지 않음) — 그래야
  // 검색 중에 필터 입력창 자신이 포커스를 잃지 않는다.
  function renderTable() {
    const q = filterInput.value.trim().toLowerCase();
    const filtered = !q ? currentList : currentList.filter(r => {
      const km = Store.getKarmaster(r.karmasterId);
      return r.id.toLowerCase().includes(q) || (r.contractNumber || '').toLowerCase().includes(q) || (r.carModel || '').toLowerCase().includes(q) || (km && karmasterDisplayName(km).toLowerCase().includes(q));
    });
    resultsBox.innerHTML = '';
    if (filtered.length === 0) { resultsBox.appendChild(el(`<div class="hint">검색 결과가 없습니다.</div>`)); return; }
    const table = el(`<table><tr><th>접수번호</th><th>제조사 계약번호</th><th>계약일자</th><th>차종</th><th>카마스터</th><th>단계</th><th>평가</th></tr></table>`);
    filtered.forEach(r => {
      const km = Store.getKarmaster(r.karmasterId);
      const needsKmRating = r.stage === 'CONFIRMED' && !r.karmasterRated;
      const ratingCell = needsKmRating ? '<span class="badge wait">카마스터 평가대기</span>' : '-';
      // 목록에서는 앱 등록시각(createdAt)보다 실제 계약서상의 계약일자(contractDate)가 계약을 식별하는 기준으로 더 유의미하다.
      // "접수번호"(r.id)는 이 앱이 자동 채번하는 내부 ID고, "제조사 계약번호"(r.contractNumber)는 제조사·딜러가 발급한 실제 계약번호다 — 서로 다른 값이라 나란히 보여준다.
      const tr = elRow(`<tr class="clickable"><td>${r.id}</td><td>${r.contractNumber || '-'}</td><td>${r.contractDate || '-'}</td><td>${r.carModel || '-'}</td><td>${km ? karmasterDisplayName(km) : '-'}</td>
        <td><span class="badge ${stageBadgeClass(r.stage)}">${stageDisplayLabel(r.stage)}</span></td><td>${ratingCell}</td></tr>`);
      tr.addEventListener('click', () => { activeId = r.id; releaseAddrDraft = ''; goto('detail'); });
      table.appendChild(tr);
    });
    resultsBox.appendChild(table);
  }
  function doSearch() {
    historyPhone = input.value;
    sessionStorage.setItem('v6_history_phone', historyPhone);
    currentList = Store.getReservationsByPhone(historyPhone);
    resultsBox.innerHTML = '';
    if (!historyPhone) { filterRow.style.display = 'none'; return; }
    if (currentList.length === 0) {
      filterRow.style.display = 'none';
      resultsBox.appendChild(el(`<div class="empty-state"><div class="big">📭</div>해당 번호로 등록된 계약이 없습니다. 카마스터가 계약을 등록하면 여기 나타납니다.</div>`));
      return;
    }
    // 계약이 여러 건일 때만 검색창을 보여준다 — 한 건뿐이면 굳이 필요 없다.
    filterRow.style.display = currentList.length > 1 ? 'flex' : 'none';
    renderTable();
  }
  filterInput.addEventListener('input', renderTable);
  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  if (historyPhone) doSearch();
  const backBtn = el(`<div style="margin-top:20px;"><button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="goto('landing')">← 처음으로</button></div>`);
  wrap.appendChild(backBtn);
  return wrap;
}

Store.onChange(() => { render(); });
Object.defineProperty(window, 'view', { get: () => view });
Object.defineProperty(window, 'activeId', { get: () => activeId });
render();
