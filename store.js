/* store.js (v6)
 * 5개 역할(구매자/카마스터/시공업체/배송기사/관리자)이 공유하는 저장소.
 * localStorage에 저장하고, storage 이벤트 + 0.5초 폴링으로 모든 창에 실시간 반영한다.
 *
 * 핵심 설계 (v6 — 서비스 구조 재편):
 *  - 제조사(현대기아) 정책상 카마스터가 온라인으로 개별 영업(상담 예약)을 진행할 수 없어,
 *    "신차인도서비스"와 "신차 케어 서비스"를 완전히 독립된 두 서비스로 분리했다.
 *
 *  [신차인도서비스] 카마스터가 오프라인 상담 후 계약 내용을 앱에 1차 기록(계약등록)
 *    -> 고객이 확인(계약확정) -> 고객이 최종 수령지와 함께 출고 요청 -> 카마스터가 공장에 출고 의뢰
 *    -> 배송중 -> 오너가 도착 확인(수령확인대기 -> 인도완료) — 이 시점이 카마스터 역할의 종료 지점이다.
 *    "출고 후 시공예정"(구 시공필요/불필요)은 카마스터가 지정한 협력업체에서 진행하는 옵션 작업
 *    여부일 뿐이며, 오프라인 계약 시점에 이미 정해지는 것이라 이 화면에서 다시 묻지 않는다.
 *
 *  [신차 케어 서비스] 신차인도서비스와 시간적으로 완전히 분리된 독립 서비스 — data.reservations에
 *    종속되지 않고 data.careOrders에 최상위로 저장된다. 고객은 "내 차량"(=자신이 등록한 신차인도서비스
 *    예약들) 중 하나를 골라 시작하며, 그 차가 아직 출고 전이든 이미 받은 차든 상관없다(신청 시점에 차량·
 *    고객 정보를 그대로 복사해온다 — 이후 원본 예약이 바뀌어도 이 주문엔 영향 없다). 시공사를 온라인에서
 *    바로 검색·선택(카마스터와 달리 오프라인 제약 없음) -> 기본 패키지 + 추가옵션 + 요청사항으로 견적을
 *    요청 -> 시공사가 가격을 결정해 회신 -> 고객이 확인(계약 완료) -> 시공사가 입고를 직접 확인(어떻게
 *    차가 왔는지는 상관하지 않는다) -> 작업중 -> 최종검수 -> 고객 검수(오너 단독) -> 출차 -> 2차 배송
 *    -> 수령(오너 단독) -> 사후처리(정찰제 확인 -> 평가 -> 포인트 적립).
 *
 *  - 두 서비스는 완전히 독립적으로 포인트를 적립한다: 신차인도서비스는 카마스터 평가,
 *    신차 케어 서비스는 시공사 평가가 각각의 포인트 적립 트리거다. 평가는 완료 즉시 또는 이후
 *    처리 이력에서 언제든("평가 대기") 남길 수 있다.
 *  - 카마스터/시공사는 평점 검색을 위해 다차원(항목별) 평가를 받는다.
 *  - 배송 구간은 "타이머 기반 자동 시뮬레이션"으로 진행되며, 각 화면이 Store를 읽을 때마다(load() 내부 _tick)
 *    도착 시점이 지난 배송을 자동으로 도착 처리하고, 지나간 체크포인트마다 이력(log)에 기록한다. 신차인도
 *    서비스 예약과 신차 케어 서비스 주문 둘 다 각자의 transit을 독립적으로 가질 수 있다.
 */

const STORE_KEY = 'auto_mvp_store_v6';
const TRANSIT_DURATION_MS = 8000; // 데모용 배송 소요시간(실제로는 실시간 GPS 기반). 8초.

// 서비스 완료 + 평가 제출 시 지급하는 플랫폼 기본 포인트. 두 서비스가 독립적으로 각각 지급한다.
const POINT_REWARD_DELIVERY = 20000; // 신차인도서비스 완료 + 카마스터 평가
const POINT_REWARD_AFTERMARKET = 30000; // 신차 케어 서비스 완료 + 시공사 평가

const DEFAULT_SHOPS = [
  { id: 'a', name: '울산 A샵', rating: 4.8, reviews: 127, count: 340, warranty: 12, hours: 3, tags: ['PPF 전문', '당일 시공'], priceAdj: 0, address: '울산광역시 남구 OO동 123-45', bonusPoint: 0, phone: '010-3333-4401' },
  { id: 'b', name: '울산 B샵', rating: 4.6, reviews: 89, count: 210, warranty: 6, hours: 4, tags: ['넓은 주차공간', '대차 지원'], priceAdj: 0, address: '울산광역시 중구 OO동 45-6', bonusPoint: 0, phone: '010-3333-4402' },
  { id: 'c', name: '울산 C샵', rating: 4.9, reviews: 56, count: 98, warranty: 12, hours: 3, tags: ['최고 평점', '신생 인증점'], priceAdj: 40000, address: '울산광역시 남구 OO동 88-1', bonusPoint: 0, phone: '010-3333-4403' },
];

const DEFAULT_KARMASTERS = [
  { id: 'k1', name: '김도현 카마스터', rating: 4.9, reviews: 212, region: '울산', tags: ['출고 전문', '리퍼럴 인증'], preferredShopId: 'a', pin: '1111', phone: '010-2222-3301', bonusPoint: 0 },
  { id: 'k2', name: '박서연 카마스터', rating: 4.7, reviews: 154, region: '울산', tags: ['신속 상담'], preferredShopId: 'c', pin: '2222', phone: '010-2222-3302', bonusPoint: 0 },
  { id: 'k3', name: '이준호 카마스터', rating: 4.95, reviews: 301, region: '부산/울산', tags: ['VIP 응대', '리퍼럴 인증'], preferredShopId: 'b', pin: '3333', phone: '010-2222-3303', bonusPoint: 0 },
];

const DEFAULT_DRIVERS = [
  { id: 'd1', name: '최기사', phone: '010-4444-5501' },
  { id: 'd2', name: '정기사', phone: '010-4444-5502' },
];

// 배송 구간별 위치 체크포인트. 신차인도서비스(예약)는 항상 공장에서 출발해 고객이 정한 최종
// 수령지(자택이든 개인적으로 구한 정비업체든)로 향하고, 신차 케어 서비스(주문)의 2차 배송은
// 시공사에서 출발해 오너에게 돌아간다 — 목적지 종류가 아니라 출발지가 다르다.
const CHECKPOINTS_FROM_FACTORY = ['공장 출발', '고속도로 이동 중', '목적지 인근 도착', '목적지 도착'];
const CHECKPOINTS_FROM_SHOP = ['시공업체 출발', '시내 구간 이동 중', '고객 근처 도착', '고객에게 배송 도착'];

const PACKAGES = [
  { id: 'basic', name: '베이직', price: 980000, desc: '틴팅 기본 등급 · 유리막 코팅', items: ['틴팅(전 유리, 기본 등급)', '유리막 코팅'] },
  { id: 'standard', name: '스탠다드', price: 1480000, desc: '중급 반사/비반사 · PPF 4종 팩', rec: true, items: ['틴팅(전 유리, 중급 반사/비반사)', 'PPF 4종 부위(도어캐치·후미등·범퍼 하단 등)', '유리막 코팅'] },
  { id: 'premium', name: '프리미엄', price: 2180000, desc: '전면 범퍼 PPF · 가죽시트 코팅', items: ['전면 범퍼 전체 PPF', '가죽시트 코팅', '유리막 코팅'] },
];

// 신차 케어 서비스 추가옵션 카탈로그 — 시공사 간 동일한 표준 항목·가격을 쓰며, 항목명+가격으로만 구성한다
// (서비스/부품비용/서비스료 분해는 이번 단계에서는 하지 않는다). 필요시 이 배열에 항목만 추가하면 확장된다.
const OPTION_CATALOG = [
  { id: 'blackbox', name: '블랙박스 장착', price: 250000 },
  { id: 'door_ppf', name: '도어 하부 PPF 추가', price: 80000 },
  { id: 'headlight_ppf', name: '헤드라이트 PPF', price: 60000 },
  { id: 'trim_wrap', name: '실내 트림 랩핑', price: 120000 },
];

// 평점 항목 — 카마스터/시공사 각각 다차원으로 관리한다. 항목별 가중치를 반영한 통합점수 산정 방식은
// 추후 결정 과제이며, 지금은 항목별 단순 평균 + 전체 평균만 계산한다.
const RATING_DIMS_KARMASTER = [
  { id: 'expertise', label: '전문성' },
  { id: 'speed', label: '응대속도' },
  { id: 'kindness', label: '친절도' },
];
const RATING_DIMS_SHOP = [
  { id: 'quality', label: '시공품질' },
  { id: 'schedule', label: '일정준수' },
  { id: 'priceAccuracy', label: '가격정확도' },
];

// 시공업체가 실제로 조작(버튼 클릭)하는 3단계. '고객검수대기'는 여기 포함되지 않는다 — 오너의 확인으로만
// 진행되는 별도 게이트이기 때문이다. short는 화면에 노출되는 버튼 라벨, code는 내부 식별자.
const SHOP_STAGES = [
  { code: '입고완료', short: '입고완료', title: '신차 입고 및 정밀 검수', info: '도장면 단차·스크래치 확인' },
  { code: '작업중', short: '작업중', title: '마스킹 및 시공 작업 중', info: '차량 보호 마스킹 후 작업 진행' },
  { code: '최종검수', short: '작업완료', title: '작업 완료 및 청구 정리', info: '시공 완료, 청구 내역 정리' },
];
// 화면 표시(타임라인)용 전체 신차 케어 서비스 단계. 시공업체가 조작하지 않는 고객검수/출차 단계도 포함한다.
const SHOP_DISPLAY_STAGES = [
  ...SHOP_STAGES,
  { code: '고객검수대기', title: '고객 검수 확인 (오너)', info: '시공 품질을 확인해야 출차가 진행됩니다' },
  { code: '출차완료', title: '출차 완료', info: '시공업체에서 출차, 배송 대기' },
];

function _emptyStore() {
  return { reservations: [], careOrders: [], shops: DEFAULT_SHOPS, karmasters: DEFAULT_KARMASTERS, drivers: DEFAULT_DRIVERS, seq: 0, careSeq: 0, pointWallets: {}, ratings: [] };
}

const Store = {
  _cache: null,
  _lastRaw: null,
  _listeners: [],

  load() {
    const raw = localStorage.getItem(STORE_KEY);
    if (!(raw !== this._lastRaw || !this._cache)) return this._cache;
    this._lastRaw = raw;
    this._cache = raw ? JSON.parse(raw) : _emptyStore();
    if (!this._cache.reservations) this._cache.reservations = [];
    if (!this._cache.careOrders) this._cache.careOrders = [];
    if (!this._cache.shops) this._cache.shops = DEFAULT_SHOPS;
    if (!this._cache.karmasters) this._cache.karmasters = DEFAULT_KARMASTERS;
    if (!this._cache.drivers) this._cache.drivers = DEFAULT_DRIVERS;
    if (!this._cache.pointWallets) this._cache.pointWallets = {};
    if (!this._cache.ratings) this._cache.ratings = [];
    this._tick(this._cache);
    return this._cache;
  },

  // 배송 타이머가 만료된 건(신차인도서비스 예약 + 신차 케어 서비스 주문 각각 독립적으로)을 자동으로
  // "도착" 처리하고, 중간에 통과한 위치 체크포인트도 시간과 함께 이력(log)에 기록한다.
  _tick(data) {
    let changed = false;
    (data.reservations || []).forEach(r => {
      if (!r.transit || !r.transit.active) return;
      const elapsed = Date.now() - r.transit.startedAt;
      if (elapsed >= r.transit.durationMs) { this._arriveReservation(r); changed = true; }
      else if (this._logCheckpoint(r)) changed = true;
    });
    (data.careOrders || []).forEach(c => {
      if (!c.transit || !c.transit.active) return;
      const elapsed = Date.now() - c.transit.startedAt;
      if (elapsed >= c.transit.durationMs) { this._arriveCareOrder(c); changed = true; }
      else if (this._logCheckpoint(c)) changed = true;
    });
    if (changed) this._persist(data, null);
  },

  _logCheckpoint(entity) {
    const idx = this._checkpointIdx(entity.transit);
    if (idx > (entity.transit.lastLoggedIdx || 0)) {
      for (let i = (entity.transit.lastLoggedIdx || 0) + 1; i <= idx; i++) {
        entity.log = (entity.log || []).concat([{ t: Date.now(), msg: `위치 업데이트 — ${entity.transit.checkpoints[i]}` }]);
      }
      entity.transit.lastLoggedIdx = idx;
      return true;
    }
    return false;
  },

  _checkpointIdx(transit) {
    const pct = Math.min(1, (Date.now() - transit.startedAt) / transit.durationMs);
    const cps = transit.checkpoints || [];
    return Math.min(cps.length - 1, Math.floor(pct * cps.length));
  },

  // 배송기사를 배정하고 목적지에 맞는 위치 체크포인트를 포함한 transit 객체를 만든다. legKind는
  // 신차인도서비스가 카마스터 지정업체를 경유하는 경우(A-경로)에만 의미가 있다 — 'to_shop'이면 도착해도
  // 오너의 수령확인으로 이어지지 않고 카마스터의 시공완료 확인을 기다린다(_arriveReservation 참고).
  _buildTransit(destination, checkpoints, legKind) {
    const drivers = DEFAULT_DRIVERS;
    const driverId = drivers[Math.floor(Math.random() * drivers.length)].id;
    return { active: true, startedAt: Date.now(), durationMs: TRANSIT_DURATION_MS, destination, driverId, checkpoints, lastLoggedIdx: 0, legKind: legKind || 'to_owner' };
  },

  // 신차인도서비스 도착. 카마스터 지정업체(A-경로)로 향하는 1차 구간이었다면 오너 수령확인으로 바로
  // 넘어가지 않고 '시공중'에서 멈춘다 — 카마스터가 업체와 소통해 시공완료를 확인해야 다음(오너에게로
  // 재배송) 구간이 시작된다. 이 과정은 고객·신차 케어 서비스와 완전히 무관한 카마스터-업체 간 별개
  // 거래라, 고객 화면에는 진행 상황만 알릴 뿐 어떤 액션도 요구하지 않는다.
  _arriveReservation(r) {
    const dest = r.transit.destination;
    const legKind = r.transit.legKind;
    r.transit = null;
    if (legKind === 'to_shop') {
      r.log = (r.log || []).concat([{ t: Date.now(), msg: `차량이 지정업체(${dest})에 도착했습니다 — 카마스터의 시공완료 확인 대기` }]);
      r.stage = '시공중';
      return;
    }
    r.log = (r.log || []).concat([{ t: Date.now(), msg: `도착 완료 — ${dest}` }]);
    r.stage = '수령확인대기';
  },
  // 신차 케어 서비스 도착(시공 완료 후 오너에게 재배송): 오너의 "수령확인" 게이트로 이어진다.
  _arriveCareOrder(c) {
    c.transit = null;
    c.log = (c.log || []).concat([{ t: Date.now(), msg: '도착 완료 — 오너' }]);
    c.status = '수령대기';
    c.ownerConfirmed = false;
  },

  _persist(data) {
    this._cache = data;
    const raw = JSON.stringify(data);
    this._lastRaw = raw;
    localStorage.setItem(STORE_KEY, raw);
    this._notify();
  },

  save(data) { this._persist(data); },

  reset() {
    localStorage.removeItem(STORE_KEY);
    this._cache = null;
    this._lastRaw = null;
    this._notify();
  },

  getShops() { return this.load().shops; },
  getShop(id) { return this.load().shops.find(s => s.id === id) || null; },
  getShopByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().shops.find(s => (s.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  getKarmasters() { return this.load().karmasters; },
  getKarmaster(id) { return this.load().karmasters.find(k => k.id === id) || null; },
  getKarmasterByPin(pin) { return this.load().karmasters.find(k => k.pin === pin) || null; },
  getKarmasterByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().karmasters.find(k => (k.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  getDrivers() { return this.load().drivers; },
  getDriverByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().drivers.find(d => (d.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },

  // ---- 신차인도서비스 예약 = "내 차량" ----
  getReservations() { return this.load().reservations.slice().sort((a, b) => b.createdAt - a.createdAt); },
  getReservationsByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return [];
    return this.getReservations().filter(r => (r.customer.phone || '').replace(/[^0-9]/g, '') === norm);
  },
  getReservationsByKarmaster(kid) { return this.getReservations().filter(r => r.karmasterId === kid); },
  getReservation(id) { return this.load().reservations.find(r => r.id === id) || null; },

  _update(id, patch, logMsg) {
    const data = this.load();
    const idx = data.reservations.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const updated = Object.assign({}, data.reservations[idx], patch);
    if (logMsg) updated.log = (updated.log || []).concat([{ t: Date.now(), msg: logMsg }]);
    data.reservations[idx] = updated;
    this.save(data);
    return updated;
  },

  // ---- 신차인도서비스: 계약내역등록(고객 시작) → 카마스터 검토·승인 ----
  // 상담·계약 체결 자체는 이미 오프라인에서 끝난 뒤다 — 이 흐름은 새로운 관계를 시작하는 게 아니라,
  // 이미 존재하는(문서화된) 계약을 디지털로 연결·관리하기 시작하는 절차다. 그래서 반드시 "고객이 먼저"
  // 시작한다 — 카마스터가 고객 정보를 임의로 입력해 계약을 만들면 오탈자·사칭 등으로 엉뚱한 사람과
  // 연결될 위험이 있기 때문이다.
  //
  // 고객은 목록에서 카마스터를 고르는 게 아니라, 계약서에 적힌 그대로(차량 모델·트림·색상·계약일자 +
  // 카마스터 연락처 + 본인 정보)를 직접 입력한다. 이 조합 자체가 실제로 그 계약서를 양쪽 다 들고 있어야만
  // 맞출 수 있는 지문 역할을 하므로, 임의의 확인 코드를 따로 타이핑하게 하지 않는다 — 카마스터는 화면에
  // 뜬 내용을 보고 "내가 실제로 계약한 것과 맞다"를 직접 확인(승인)하면 된다.
  //  - 입력한 연락처가 이미 등록된 카마스터와 일치하면 그 카마스터의 대시보드에 승인 대기 건으로 즉시 뜬다.
  //  - 일치하지 않으면(아직 미등록 카마스터) karmasterId 없이 조회번호만 발급된다. 앱은 이 조회번호를
  //    대신 전달하지 않는다 — 실제 계약 당사자인 고객이 본인 채널로 직접 그 카마스터에게 알려야 한다
  //    (예: "이 앱으로 계약 관리하고 싶어요, 아래 번호로 가입해서 확인해주세요"). 카마스터가 그 번호로
  //    가입하면 등록과 동시에 이 계약에 자동 연결된다 (onboardKarmasterAndFillContract).
  _genCode() { return String(Math.floor(100000 + Math.random() * 900000)); },
  // 계약번호 포맷: "SS-YYYYMM-NNNN" (서비스유형-등록연월-일련번호).
  //  - SS: 서비스유형(10=신차인도서비스, 20=신차 케어 서비스) — 두 서비스는 완전히 독립된 계약이라 번호 자체도 분리했다.
  //  - YYYYMM: 이 앱에 등록(디지털화)된 연월 — 실제 계약일자(contractDate)와는 다를 수 있다(예: 계약은 미리, 등록은 나중에).
  //  - NNNN: 해당 서비스유형 내에서 몇 번째 계약인지(전체 누적), 서비스유형별로 별도 카운터를 쓴다.
  _fmtReservationId(serviceCode, seqNum) {
    const now = new Date();
    const yyyymm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
    return `${serviceCode}-${yyyymm}-${String(seqNum).padStart(4, '0')}`;
  },
  startContractRequest({ karmasterPhone, customer, carModel, trim, color, contractDate }) {
    const km = this.getKarmasterByPhone(karmasterPhone);
    const data = this.load();
    data.seq = (data.seq || 0) + 1;
    const id = this._fmtReservationId('10', data.seq);
    const noticeMsg = '계약 내용을 확인하고 승인해 주세요. (자동 안내)';
    const reservation = {
      id,
      createdAt: Date.now(),
      stage: '고객요청',
      confirmCode: this._genCode(), // 미등록 카마스터가 자신을 찾기 위한 조회번호일 뿐, 보안 비밀값이 아니다
      karmasterId: km ? km.id : null,
      pendingKarmasterPhone: km ? '' : (karmasterPhone || ''),
      customer,
      carModel: carModel || '', trim: trim || '', color: color || '', contractDate: contractDate || '',
      needsService: null,
      consultMemo: '',
      karmasterShopName: '', // 카마스터가 지정한 협력업체명(선택) — 카마스터-업체 간 별개 거래라 고객은 관여하지 않는다
      ownerReleaseRequested: false, // 고객이 "이제 차를 받고 싶다"고 먼저 요청해야 카마스터가 출고를 의뢰할 수 있다
      deliveryAddress: '', // 최종 수령지 — 출고 요청 시점에 고객이 정한다(자택이든 별도 이용할 시공·정비업체든)
      transit: null,
      karmasterRated: false,
      karmasterPointsEarned: 0,
      messages: [{ from: 'customer', text: noticeMsg, t: Date.now() }],
      karmasterUnread: true,
      log: [{ t: Date.now(), msg: km ? '고객이 계약내역을 등록했습니다 — 카마스터 승인 대기' : '고객이 미등록 카마스터를 지정해 계약내역을 등록 — 조회번호 발급 (등록 시 자동 연결)' }],
    };
    data.reservations.push(reservation);
    this.save(data);
    return reservation;
  },
  // 카마스터가 화면에 뜬 계약 내용(차량정보·계약일자·고객정보)을 검토하고 승인 — 이 시점부터 처리가
  // 실제로 시작된다. 차량정보는 고객이 이미 입력해뒀으므로 여기서는 시공여부·상담메모만 채운다.
  fillContractDetails(id, { needsService, consultMemo, karmasterShopName }) {
    const r = this.getReservation(id);
    if (!r || r.stage !== '고객요청') return r;
    return this._update(id, { needsService, consultMemo: consultMemo || '', karmasterShopName: karmasterShopName || '', stage: '계약등록' },
      `카마스터가 계약 내용을 검토하고 승인했습니다 — 차종: ${r.carModel}, 시공: ${needsService ? '필요' : '불필요'}`);
  },
  // 미등록 카마스터가 조회번호로 자신에게 온 요청을 찾는다. 보안은 코드 소유 여부가 아니라, 이어지는
  // 화면에서 카마스터 본인이 차량정보·계약일자·고객정보를 눈으로 검토하고 승인하는 데서 나온다.
  getReservationByToken(token) {
    const t = (token || '').trim();
    if (!t) return null;
    return this.load().reservations.find(r => r.confirmCode === t && r.stage === '고객요청' && !r.karmasterId) || null;
  },
  onboardKarmasterAndFillContract(id, { name, region, needsService, consultMemo, karmasterShopName }) {
    const data = this.load();
    const idx = data.reservations.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const r = data.reservations[idx];
    if (r.stage !== '고객요청' || r.karmasterId) return r;
    const newKarmaster = {
      id: 'k' + Date.now(), name, rating: 0, reviews: 0, region: region || '',
      tags: [], preferredShopId: null, pin: String(Math.floor(1000 + Math.random() * 9000)),
      phone: r.pendingKarmasterPhone || '', bonusPoint: 0,
    };
    data.karmasters.push(newKarmaster);
    const updated = Object.assign({}, r, {
      karmasterId: newKarmaster.id, pendingKarmasterPhone: '',
      needsService, consultMemo: consultMemo || '', karmasterShopName: karmasterShopName || '', stage: '계약등록',
    });
    updated.log = (updated.log || []).concat([{ t: Date.now(), msg: `신규 카마스터(${name}) 등록과 동시에 계약 내용 승인 — 조회번호로 자동 연결` }]);
    data.reservations[idx] = updated;
    this.save(data);
    return updated;
  },
  // 관리자 전용 신속처리 경로 — 고객 요청→카마스터 승인 2단계를 건너뛰고 한 번에 계약을 등록한다.
  // (관리자는 데모 신속 진행을 위해 전 과정을 대신 처리할 수 있는 별도 권한을 갖는다.)
  createContractRecordDirect(partial) {
    const data = this.load();
    data.seq = (data.seq || 0) + 1;
    const id = this._fmtReservationId('10', data.seq);
    const reservation = Object.assign({
      id,
      createdAt: Date.now(),
      stage: '계약등록',
      confirmCode: this._genCode(),
      karmasterId: null,
      customer: { name: '', phone: '', nickname: '' },
      carModel: '', trim: '', color: '', contractDate: '',
      needsService: null,
      consultMemo: '',
      karmasterShopName: '',
      ownerReleaseRequested: false,
      deliveryAddress: '',
      transit: null,
      karmasterRated: false,
      karmasterPointsEarned: 0,
      messages: [],
      karmasterUnread: false,
      log: [{ t: Date.now(), msg: '관리자가 계약을 대리 등록했습니다 (고객요청·카마스터 승인 절차 생략)' }],
    }, partial);
    data.reservations.push(reservation);
    this.save(data);
    return reservation;
  },

  // 고객이 카마스터가 기록한 계약 내용을 확인한다.
  confirmContractByCustomer(id) {
    return this._update(id, { stage: '계약확정' }, '고객이 계약 내용을 확인했습니다');
  },

  // ---- 신차인도서비스: 출고 요청 (고객 → 카마스터 2단계) ----
  // 계약이 확정됐다고 곧바로 출고가 시작되는 게 아니다 — 고객이 먼저 "이제 차를 받고 싶다"는 의사표시로
  // 최종 수령지와 함께 출고를 요청하면, 그걸 받은 카마스터가 실제로 공장에 출고를 의뢰한다. 출고 후
  // 시공예정(카마스터 지정업체 옵션시공) 여부는 오프라인 계약 시점에 이미 정해진 것이라 이 단계에서 다시
  // 묻지 않는다. 신차 케어 서비스는 이 흐름과 시간적으로 완전히 분리된 별개 서비스라 그 진행 상태가
  // 출고 자체를 막지 않는다 — 최종 수령지는 출고 전까지 고객이 언제든 자유롭게 정하거나 바꿀 수 있다.
  requestOwnerRelease(id, deliveryAddress) {
    const r = this.getReservation(id);
    if (!r || r.stage !== '계약확정' || r.ownerReleaseRequested) return r;
    const addr = (deliveryAddress || '').trim();
    return this._update(id, { ownerReleaseRequested: true, deliveryAddress: addr },
      `고객이 출고를 요청했습니다 — 최종 수령지: ${addr || '미지정'} · 카마스터가 확인 후 공장에 출고를 의뢰합니다`);
  },
  canRequestRelease(r) {
    return !!(r && r.stage === '계약확정' && r.ownerReleaseRequested);
  },
  requestRelease(id) {
    const r = this.getReservation(id);
    if (!this.canRequestRelease(r)) return r;
    // 출고 후 시공예정(A-경로)이면 최종 목적지 전에 카마스터 지정업체를 먼저 들른다 — 이건 카마스터와
    // 업체 사이의 별개 거래라 고객은 관여하지 않고, 오너 수령확인 게이트로 바로 이어지지 않는다
    // (_arriveReservation의 legKind==='to_shop' 분기 참고).
    if (r.needsService) {
      const shopLabel = r.karmasterShopName || '지정업체';
      return this._update(id, { stage: '배송중', transit: this._buildTransit(shopLabel, CHECKPOINTS_FROM_FACTORY, 'to_shop') },
        `카마스터가 공장에 출고를 의뢰했습니다 — 배송기사 배정, 1차 목적지: ${shopLabel}`);
    }
    const destination = r.deliveryAddress || '고객 지정 수령지';
    return this._update(id, { stage: '배송중', transit: this._buildTransit(destination, CHECKPOINTS_FROM_FACTORY, 'to_owner') },
      `카마스터가 공장에 출고를 의뢰했습니다 — 배송기사 배정, 목적지: ${destination}`);
  },
  // 카마스터가 지정업체와 소통해 시공완료를 확인 — 고객·신차 케어 서비스와 무관한 카마스터-업체 간
  // 별개 거래이므로, 이 확인은 오직 카마스터만 할 수 있고 최종 목적지로의 재배송을 직접 시작시킨다.
  confirmKarmasterShopDone(id) {
    const r = this.getReservation(id);
    if (!r || r.stage !== '시공중') return r;
    const destination = r.deliveryAddress || '고객 지정 수령지';
    return this._update(id, { stage: '배송중', transit: this._buildTransit(destination, CHECKPOINTS_FROM_SHOP, 'to_owner') },
      `카마스터가 지정업체 시공완료를 확인했습니다 — 최종 목적지로 재배송 시작: ${destination}`);
  },

  // 관리자/배송기사용: 배송 즉시 도착 처리 (데모 단축). 신차인도서비스 예약과 신차 케어 서비스 주문
  // 둘 다 각자 transit을 가질 수 있어서 같은 id로 두 군데 다 찾아본다.
  forceArrive(id) {
    const data = this.load();
    const r = data.reservations.find(x => x.id === id);
    if (r && r.transit) { this._arriveReservation(r); this.save(data); return r; }
    const c = data.careOrders.find(x => x.id === id);
    if (c && c.transit) { this._arriveCareOrder(c); this.save(data); return c; }
    return null;
  },

  // 오너가 차량 도착을 확인한다 — 목적지와 무관하게 이 시점에 카마스터의 신차인도서비스 역할이 끝난다.
  // 신차 케어 서비스는 완전히 별개 서비스이므로 여기서는 더 이상 건드리지 않는다 — 시공사가 스스로
  // "입고 확인"을 눌러야 그쪽 진행이 시작된다.
  confirmDelivery(id) {
    const r = this.getReservation(id);
    if (!r || r.stage !== '수령확인대기') return r;
    return this._update(id, { stage: '인도완료' }, '차량 수령 확인 — 신차인도서비스 완료');
  },

  // ---- 신차 케어 서비스: 최상위 독립 엔티티 ----
  getCareOrders() { return this.load().careOrders.slice().sort((a, b) => b.createdAt - a.createdAt); },
  getCareOrdersByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return [];
    return this.getCareOrders().filter(c => (c.customer.phone || '').replace(/[^0-9]/g, '') === norm);
  },
  getCareOrdersByReservation(reservationId) { return this.getCareOrders().filter(c => c.reservationId === reservationId); },
  getCareOrder(id) { return this.load().careOrders.find(c => c.id === id) || null; },
  _updateCare(id, patch, logMsg) {
    const data = this.load();
    const idx = data.careOrders.findIndex(c => c.id === id);
    if (idx === -1) return null;
    const updated = Object.assign({}, data.careOrders[idx], patch);
    if (logMsg) updated.log = (updated.log || []).concat([{ t: Date.now(), msg: logMsg }]);
    data.careOrders[idx] = updated;
    this.save(data);
    return updated;
  },

  // "내 차량"(=신차인도서비스로 등록한 예약) 중 하나를 골라 신청한다. 그 예약이 아직 출고 전이든
  // 이미 받은 차든 상관없다. 차량·고객 정보는 신청 시점에 그 예약에서 그대로 복사해온다.
  requestCareOrder({ reservationId, shopId, mode, packageId, optionIds, customRequest }) {
    const source = this.getReservation(reservationId);
    if (!source) return null;
    const pkg = PACKAGES.find(p => p.id === packageId);
    const options = (optionIds || []).map(oid => OPTION_CATALOG.find(o => o.id === oid)).filter(Boolean);
    const shop = this.getShop(shopId);
    const data = this.load();
    data.careSeq = (data.careSeq || 0) + 1;
    const id = this._fmtReservationId('20', data.careSeq);
    const order = {
      id, reservationId,
      customer: source.customer,
      carModel: source.carModel, trim: source.trim, color: source.color,
      createdAt: Date.now(),
      shopId, mode, package: pkg, options,
      customRequest: customRequest || '',
      quotedPrice: null, status: 'requested', ownerConfirmed: false,
      pointsUsed: 0, chargedPrice: null, chargeNote: '', priceMatch: null,
      disputed: false, disputeReason: '', shopRated: false, shopPointsEarned: 0,
      photos: [], transit: null,
      log: [{ t: Date.now(), msg: `신차 케어 서비스 신청 — 시공사: ${shop ? shop.name : ''} (${mode === 'online' ? '온라인 즉시견적' : '방문 협의'}) · 대상 차량: ${source.carModel || ''} (${reservationId})` }],
    };
    data.careOrders.push(order);
    this.save(data);
    return order;
  },
  aftermarketSuggestedPrice(am) {
    if (!am || !am.package) return 0;
    return am.package.price + (am.options || []).reduce((s, o) => s + o.price, 0);
  },
  respondCareQuote(id, price) {
    return this._updateCare(id, { quotedPrice: price, status: 'quoted' }, `시공사 견적 회신 — ${fmtMoney(price)}`);
  },
  confirmCareQuote(id, pointsUsed) {
    const c = this.getCareOrder(id);
    if (!c) return null;
    const balance = this.getPointBalance(c.customer.phone);
    const used = Math.max(0, Math.min(pointsUsed || 0, balance, c.quotedPrice || 0));
    const updated = this._updateCare(id, { status: 'confirmed', pointsUsed: used },
      `고객이 견적 확인 — 신차 케어 서비스 계약 완료${used ? ` · 포인트 ${used.toLocaleString()}P 사용` : ''}`);
    if (used > 0) {
      const data = this.load();
      this._adjustPoints(data, c.customer.phone, -used, `신차 케어 서비스 결제 사용 (${id})`);
      this.save(data);
    }
    return updated;
  },

  // ---- 신차 케어 서비스: 입고 ~ 시공업체 처리 ----
  // 차가 실제로 어떻게 시공사에 도착했는지(신차인도서비스 배송에 얹혀 왔든, 고객이 나중에 직접 몰고
  // 왔든)는 이 서비스가 상관할 바 아니다 — 시공사가 "입고 확인"을 누르는 것 자체로 그 사실을 확정한다.
  confirmCareDropoff(id) {
    const c = this.getCareOrder(id);
    if (!c || c.status !== 'confirmed') return c;
    return this._updateCare(id, { status: '입고완료' }, '입고 확인 — 시공 개시');
  },
  setCareShopStage(id, code) {
    const c = this.getCareOrder(id);
    if (!c) return null;
    return this._updateCare(id, { status: code }, `시공 상태 변경 → ${code}`);
  },
  addCareSamplePhoto(id, generateFn) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const photos = (c.photos || []).slice();
    if (photos.length >= 3) return c;
    photos.push({ src: generateFn(photos.length, `현장 사진 ${photos.length + 1}`), label: `샘플 사진 ${photos.length + 1}` });
    return this._updateCare(id, { photos }, `샘플 이미지 추가 (${photos.length}번째)`);
  },
  addCareUploadedPhoto(id, dataUrl, filename) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const photos = (c.photos || []).slice();
    if (photos.length >= 3) return c;
    photos.push({ src: dataUrl, label: filename || `업로드 사진 ${photos.length + 1}` });
    return this._updateCare(id, { photos }, `실제 파일 업로드: ${filename} (${photos.length}번째)`);
  },
  // 견적가(사전 확정)에 추가금액·작업내역을 더해 한 번에 청구액을 확정한다.
  setCareCharged(id, extra, note) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const base = c.quotedPrice || 0;
    const price = base + (extra || 0);
    const priceLine = extra > 0 ? `견적가 ${fmtMoney(base)} + 추가 ${fmtMoney(extra)}` : '견적가 동일';
    return this._updateCare(id, { chargedPrice: price, chargeNote: note || '' }, `실제 청구액 입력 — ${priceLine}${note ? ` / 작업 내역: ${note}` : ''}`);
  },
  requestCareInspection(id) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    return this._updateCare(id, { status: '고객검수대기', ownerConfirmed: false }, '시공업체가 고객 검수를 요청했습니다 (출차 전 확인 필요)');
  },

  // ---- 신차 케어 서비스: 오너 단독 확인 게이트 (고객검수대기 → 출차완료 / 수령대기 → 수령확인) ----
  // 카마스터는 신차인도서비스 완료 시점에 이미 역할이 끝났으므로, 이 게이트들은 카마스터 확인을 요구하지 않는다.
  ownerConfirmCare(id) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    if (c.status === '고객검수대기') return this._updateCare(id, { status: '출차완료', ownerConfirmed: true }, '고객 검수(출차 승인) (오너)');
    if (c.status === '수령대기') return this._updateCare(id, { status: '수령확인', ownerConfirmed: true }, '최종 수령 확인 (오너)');
    return c;
  },
  raiseCareDispute(id, reason) {
    return this._updateCare(id, { disputed: true, disputeReason: reason || '' }, `⚠ 고객 검수 불만족 제기 — 사유: ${reason || '(미입력)'}`);
  },
  resolveCareDispute(id) {
    return this._updateCare(id, { disputed: false }, '품질 이의제기 처리 완료 (관리자 확인)');
  },
  // 신차 케어 서비스에서만 존재하는 개념 — 사전 확정 견적과 실제 청구액이 같았는지 오너가 확인한다.
  answerCarePriceCheck(id, match) {
    return this._updateCare(id, { priceMatch: match }, match ? '정찰제 이행 확인(일치)' : '정찰제 불일치 제보');
  },
  // 시공 완료 후 2차 배송(오너에게) 시작 — 신차 케어 서비스 자신의 독립된 배송이다.
  startCareSecondLeg(id) {
    return this._updateCare(id, { transit: this._buildTransit('오너', CHECKPOINTS_FROM_SHOP) }, '시공 완료 — 오너에게 재배송 시작');
  },
  shareReview(id) { return this._updateCare(id, { reviewShared: true }, '후기 게시 완료'); },

  // ---- 평점 시스템 (카마스터/시공사 다차원 평가) ----
  // 완료 즉시 남길 수도 있고, 처리 이력에서 "평가 대기" 건을 찾아 이후에 남길 수도 있다 — 완료 시점에
  // 강제하지 않는다. 평가 제출 자체가 각 서비스의 포인트 적립 트리거다. 카마스터 평가는 신차인도서비스
  // 예약을, 시공사 평가는 신차 케어 서비스 주문을 대상으로 한다 — 서로 다른 최상위 엔티티라 따로 처리한다.
  ratingDims(targetType) { return targetType === 'karmaster' ? RATING_DIMS_KARMASTER : RATING_DIMS_SHOP; },
  submitRating(targetType, targetId, refId, scores, comment) {
    const data = this.load();
    data.ratings = data.ratings || [];
    if (targetType === 'karmaster') {
      const idx = data.reservations.findIndex(x => x.id === refId);
      if (idx === -1) return null;
      const r = data.reservations[idx];
      data.ratings.push({ id: 'RT' + Date.now() + Math.floor(Math.random() * 1000), targetType, targetId, reservationId: refId, phone: r.customer.phone, scores, comment: comment || '', createdAt: Date.now() });
      const provider = data.karmasters.find(k => k.id === targetId);
      const total = POINT_REWARD_DELIVERY + ((provider && provider.bonusPoint) || 0);
      this._adjustPoints(data, r.customer.phone, total, `카마스터 평가 리워드 (${refId})`);
      const updated = Object.assign({}, r, { karmasterRated: true, karmasterPointsEarned: total });
      updated.log = (updated.log || []).concat([{ t: Date.now(), msg: `카마스터 평가 제출 — 포인트 ${total.toLocaleString()}P 적립` }]);
      data.reservations[idx] = updated;
      this.save(data);
      return updated;
    }
    const idx = data.careOrders.findIndex(x => x.id === refId);
    if (idx === -1) return null;
    const c = data.careOrders[idx];
    data.ratings.push({ id: 'RT' + Date.now() + Math.floor(Math.random() * 1000), targetType, targetId, careOrderId: refId, phone: c.customer.phone, scores, comment: comment || '', createdAt: Date.now() });
    const provider = data.shops.find(s => s.id === targetId);
    const total = POINT_REWARD_AFTERMARKET + ((provider && provider.bonusPoint) || 0);
    this._adjustPoints(data, c.customer.phone, total, `시공사 평가 리워드 (${refId})`);
    const updated = Object.assign({}, c, { shopRated: true, shopPointsEarned: total });
    updated.log = (updated.log || []).concat([{ t: Date.now(), msg: `시공사 평가 제출 — 포인트 ${total.toLocaleString()}P 적립` }]);
    data.careOrders[idx] = updated;
    this.save(data);
    return updated;
  },
  getRatingsFor(targetType, targetId) {
    const list = (this.load().ratings || []).filter(r => r.targetType === targetType && r.targetId === targetId);
    const dims = this.ratingDims(targetType);
    const avgByDim = {};
    dims.forEach(d => {
      const vals = list.map(r => r.scores[d.id]).filter(v => typeof v === 'number');
      avgByDim[d.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    const overallVals = [];
    list.forEach(r => dims.forEach(d => { if (typeof r.scores[d.id] === 'number') overallVals.push(r.scores[d.id]); }));
    const overall = overallVals.length ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length : null;
    return { count: list.length, avgByDim, overall, list };
  },

  sendMessage(id, from, text) {
    const r = this.getReservation(id);
    if (!r || !text.trim()) return null;
    const messages = (r.messages || []).concat([{ from, text: text.trim(), t: Date.now() }]);
    const patch = { messages };
    if (from === 'customer') patch.karmasterUnread = true;
    else patch.karmasterUnread = false;
    return this._update(id, patch, null);
  },
  markMessagesRead(id) {
    const r = this.getReservation(id);
    if (!r || !r.karmasterUnread) return r;
    return this._update(id, { karmasterUnread: false }, null);
  },

  // ---- 포인트 지갑 (전화번호 기준) — 계좌이체 없이, 앱 내 결제에서 현금처럼 차감된다 ----
  _adjustPoints(data, phone, delta, reason) {
    if (!phone) return;
    const wallet = data.pointWallets[phone] || { balance: 0, history: [] };
    wallet.balance = Math.max(0, wallet.balance + delta);
    wallet.history = wallet.history.concat([{ t: Date.now(), delta, reason }]);
    data.pointWallets[phone] = wallet;
  },
  getPointBalance(phone) { return (this.load().pointWallets[phone] || { balance: 0 }).balance; },
  getPointHistory(phone) { return (this.load().pointWallets[phone] || { history: [] }).history; },

  onChange(cb) {
    this._listeners.push(cb);
    window.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY) { this._cache = null; this._lastRaw = null; cb(); }
    });
    // 0.5초마다 배송 만료 여부만 조용히 확인한다 (load() 내부의 _tick).
    // 실제로 데이터가 바뀐 경우에만 재렌더링 콜백을 호출한다 — 그렇지 않으면
    // 입력 중인 한글 조합(자모 합성)이나 열려있는 달력 선택기가 매번 끊긴다.
    setInterval(() => {
      const before = this._lastRaw;
      this.load();
      if (this._lastRaw !== before) cb();
    }, 500);
  },

  _notify() { this._listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
};

// 5개 화면 스크립트가 공통으로 쓰는 DOM 생성 헬퍼.
// elRow는 <tr>을 <table> 컨텍스트 없이 만들면 브라우저가 태그를 깨뜨리는 문제(v3~v5에서 반복 발생)를 막기 위한 것 —
// 화면별로 각자 구현하면 이 버그가 다시 생길 수 있어 여기 한 곳에만 둔다.
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function elRow(html) { const t = document.createElement('table'); t.innerHTML = html.trim(); return t.querySelector('tr'); }

function fmtMoney(n) { return (n || 0).toLocaleString('ko-KR') + '원'; }
function fmtPoint(n) { return (n || 0).toLocaleString('ko-KR') + 'P'; }
function fmtTime(t) {
  const d = new Date(t);
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtStars(avg) {
  if (avg === null || avg === undefined) return '평가 없음';
  return '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) + ` (${avg.toFixed(1)})`;
}
function stageBadgeClass(stage) {
  if (stage === '인도완료') return 'done';
  if (stage === '고객요청' || stage === '계약등록') return 'wait';
  return 'info';
}
function amBadgeClass(status) {
  if (status === '완료' || status === '수령확인') return 'done';
  if (status === 'requested' || status === 'quoted') return 'wait';
  return 'info';
}
function transitProgress(entity) {
  if (!entity.transit || !entity.transit.active) return null;
  const pct = Math.min(1, (Date.now() - entity.transit.startedAt) / entity.transit.durationMs);
  const remainMs = Math.max(0, entity.transit.durationMs - (Date.now() - entity.transit.startedAt));
  const cps = entity.transit.checkpoints || [];
  const scaled = pct * cps.length;
  const cpIdx = Math.min(cps.length - 1, Math.floor(scaled));
  const segPct = Math.min(1, Math.max(0, scaled - cpIdx)); // 현재 체크포인트 구간 안에서의 진행률 (0~1)
  const driver = (window.Store ? window.Store.getDrivers() : []).find(d => d.id === entity.transit.driverId);
  return {
    pct, remainSec: Math.ceil(remainMs / 1000), destination: entity.transit.destination,
    cpIdx, segPct, checkpointLabel: cps[cpIdx] || '위치 확인 중',
    driverName: driver ? driver.name : '배정 중',
  };
}

// 배송 진행 상황을 "슬라이드 진행바" 대신 단계별 스텝 인디케이터로 표시한다.
// 다음 체크포인트로 넘어가는 구간이 "순간 이동"처럼 보이지 않도록, 진입 중인 연결선은 segPct만큼 채워서 이동 중임을 보여준다.
function renderDeliveryStepperHTML(entity) {
  if (!entity.transit) return '';
  const cps = entity.transit.checkpoints || [];
  const tp = transitProgress(entity);
  const idx = tp.cpIdx;
  const steps = cps.map((label, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'cur' : '');
    const fillPct = i < idx ? 100 : (i === idx ? Math.round(tp.segPct * 100) : 0);
    return `<div class="dstep ${cls}"><div class="dstep-line"><div class="dstep-line-fill" style="width:${fillPct}%"></div></div><div class="dstep-dot">${i + 1}</div><div class="dstep-label">${label}</div></div>`;
  }).join('');
  return `<div class="dstepper">${steps}</div>`;
}

// 신차 케어 서비스 처리 타임라인(사진 포함) — 고객·시공업체·관리자가 동일한 화면을 볼 수 있도록 공용으로 뺐다.
// c.status(신차 케어 서비스 주문 자체의 상태)를 기준으로 진행 위치를 표시한다.
function renderShopTimelineHTML(c) {
  const idx = SHOP_DISPLAY_STAGES.findIndex(s => s.code === c.status);
  const items = SHOP_DISPLAY_STAGES.map((s, i) => {
    const cls = i < idx ? 'on' : (i === idx ? 'cur' : '');
    return `<div class="tl-item"><div class="tl-line"></div><div class="tl-dot ${cls}"></div>
      <div class="tl-name ${i > idx ? 'pending' : ''}">${s.title}</div>
      <div class="tl-desc">${i <= idx ? s.info : ''}</div></div>`;
  }).join('');
  const photoList = c.photos || [];
  const photos = photoList.length > 0
    ? `<div class="photo-row">${photoList.map(p => `<img src="${p.src}" alt="${p.label}" style="flex:1;height:100px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`).join('')}</div>`
    : `<div class="hint">아직 업로드된 사진이 없습니다.</div>`;
  return `<div class="tl-wrap">${items}</div><h4 style="margin-top:14px;">현장 실시간 업로드 사진</h4>${photos}`;
}

// 신차인도서비스 예약 하나의 전체 처리 이력, 또는 신차 케어 서비스 주문 하나의 전체 처리 이력
// (시간대별 도착/출발/상태변경 로그) — 두 엔티티 모두 같은 log 배열 구조를 쓰므로 공용으로 쓴다.
function renderHistoryLogHTML(entity) {
  const entries = (entity.log || []).slice().reverse();
  if (entries.length === 0) return `<div class="hint">아직 기록된 이력이 없습니다.</div>`;
  return `<div class="log-list">${entries.map(l => `<div><span class="t">${fmtTime(l.t)}</span>${l.msg}</div>`).join('')}</div>`;
}

const SAMPLE_PALETTES = [
  ['#dbe9f7', '#2f6fa8'], ['#e7f3dd', '#4c7a2a'], ['#fbe8d9', '#b5651d'], ['#f3e2f0', '#8a3f7a'],
];
function generateSamplePhoto(index, label) {
  const [bg, fg] = SAMPLE_PALETTES[index % SAMPLE_PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220">
    <rect width="320" height="220" fill="${bg}"/>
    <circle cx="160" cy="90" r="34" fill="${fg}" opacity="0.25"/>
    <text x="160" y="96" font-family="sans-serif" font-size="15" fill="${fg}" text-anchor="middle" font-weight="bold">${label}</text>
    <text x="160" y="150" font-family="sans-serif" font-size="11" fill="${fg}" text-anchor="middle" opacity="0.7">샘플 이미지 (데모)</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

window.Store = Store;
window.PACKAGES = PACKAGES;
window.OPTION_CATALOG = OPTION_CATALOG;
window.RATING_DIMS_KARMASTER = RATING_DIMS_KARMASTER;
window.RATING_DIMS_SHOP = RATING_DIMS_SHOP;
window.SHOP_STAGES = SHOP_STAGES;
window.SHOP_DISPLAY_STAGES = SHOP_DISPLAY_STAGES;
window.fmtMoney = fmtMoney;
window.fmtPoint = fmtPoint;
window.fmtTime = fmtTime;
window.fmtStars = fmtStars;
window.stageBadgeClass = stageBadgeClass;
window.amBadgeClass = amBadgeClass;
window.transitProgress = transitProgress;
window.renderDeliveryStepperHTML = renderDeliveryStepperHTML;
window.renderShopTimelineHTML = renderShopTimelineHTML;
window.renderHistoryLogHTML = renderHistoryLogHTML;
window.generateSamplePhoto = generateSamplePhoto;
window.TRANSIT_DURATION_MS = TRANSIT_DURATION_MS;
window.POINT_REWARD_DELIVERY = POINT_REWARD_DELIVERY;
window.POINT_REWARD_AFTERMARKET = POINT_REWARD_AFTERMARKET;
