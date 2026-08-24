/* driver.js (v5) — 배송기사 화면은 최소한으로 유지한다. 배송은 기본적으로
 * 타이머 기반 자동 시뮬레이션으로 진행되며, 배송기사는 필요시 "즉시 도착 처리"만 누른다. */

let loggedInDriverId = sessionStorage.getItem('v5_driver_id') || null;

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}

// 실제 서비스와 동일하게 연락처 입력으로 로그인하는 화면을 기본으로 두고, 테스트 시 번거로움을
// 줄이기 위해 평소엔 접혀 있는 "빠른 로그인" 드롭다운만 아래에 덧붙인다.
function renderLogin() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">배송기사 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 연락처로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:11.5px;color:#888;">테스트 계정으로 빠른 로그인</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getDrivers().map(d => `<option value="${d.id}">${d.name} · ${d.phone}</option>`).join('')}
      </select>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  submitBtn.addEventListener('click', () => {
    const driver = Store.getDriverByPhone(phoneEl.value);
    if (!driver) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    tryLogin(driver.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function tryLogin(id) { loggedInDriverId = id; sessionStorage.setItem('v5_driver_id', id); render(); }
function logout() { loggedInDriverId = null; sessionStorage.removeItem('v5_driver_id'); render(); }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInDriverId) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(renderLogin());
    return;
  }
  const driver = Store.getDrivers().find(d => d.id === loggedInDriverId);
  // 신차인도서비스(예약)의 출고 배송과, 신차 케어 서비스(주문)의 2차 배송(작업완료 후 오너 인도)은
  // 서로 완전히 독립된 서비스지만, 배송기사 입장에서는 둘 다 "지금 굴러가고 있는 배송건"일 뿐이라
  // 하나의 목록에 함께 보여준다.
  const resList = Store.getReservations().filter(r => r.transit && r.transit.active).map(r => ({ entity: r, kind: 'reservation' }));
  const careList = Store.getCareOrders().filter(c => c.transit && c.transit.active).map(c => ({ entity: c, kind: 'care' }));
  const list = [...resList, ...careList];
  document.getElementById('header-right').textContent = `${driver.name} 로그인중 · 배송중 ${list.length}건`;
  root.appendChild(el(`<div class="btn-row" style="justify-content:flex-end;"><button class="btn btn-outline" style="width:auto;padding:8px 16px;" onclick="logout()">로그아웃</button></div>`));

  if (list.length === 0) {
    root.appendChild(el(`<div class="empty-state"><div class="big">🚚</div>현재 배송중인 차량이 없습니다.<br><span style="font-size:11.5px;">고객이 출고를 요청하거나 시공업체가 재배송을 시작하면 여기 나타납니다.</span></div>`));
    return;
  }

  list.forEach(({ entity, kind }) => {
    const tp = transitProgress(entity);
    const legLabel = kind === 'care' ? '배송 (시공 완료 후 오너 인도)' : (entity.transit.legKind === 'to_shop' ? '배송 (지정업체행)' : '배송 (고객 인도)');
    const svcLabel = kind === 'care' ? '신차 케어 서비스' : '신차인도서비스';
    const destLabel = tp.destination;
    const card = el(`<div class="admin-controls" data-rid="${entity.id}" data-kind="${kind}">
      <h4>${entity.id} · ${entity.carModel} · ${legLabel}</h4>
      <div class="hint" style="margin-bottom:8px;">${svcLabel} · 담당 기사: <b>${tp.driverName}</b> · 목적지: ${destLabel}</div>
      <div id="dstepper-${entity.id}">${renderDeliveryStepperHTML(entity)}</div>
      <div class="hint transit-remain" style="margin:8px 0;">다음 위치까지 약 ${tp.remainSec}초 남음</div>
      <button class="btn btn-sm" id="arrive-${entity.id}">즉시 도착 처리</button>
    </div>`);
    card.querySelector(`#arrive-${entity.id}`).addEventListener('click', () => { Store.forceArrive(entity.id); render(); });
    root.appendChild(card);
  });
}

// 전체 재렌더 없이, 화면에 이미 그려진 스텝 인디케이터/잔여시간만 0.3초마다 직접 갱신한다.
setInterval(() => {
  document.querySelectorAll('[data-rid]').forEach(card => {
    const id = card.getAttribute('data-rid');
    const kind = card.getAttribute('data-kind');
    const entity = kind === 'care' ? Store.getCareOrder(id) : Store.getReservation(id);
    if (!entity || !entity.transit || !entity.transit.active) return; // 도착 시점 전환은 onChange의 정식 재렌더가 처리
    const tp = transitProgress(entity);
    const remainEl = card.querySelector('.transit-remain');
    const stepSlot = card.querySelector(`#dstepper-${entity.id}`);
    if (remainEl) remainEl.textContent = `다음 위치까지 약 ${tp.remainSec}초 남음`;
    if (stepSlot) stepSlot.innerHTML = renderDeliveryStepperHTML(entity);
  });
}, 300);

Store.onChange(() => { render(); });
render();
