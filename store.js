/* store.js (v6)
 * 5개 역할(구매자/카마스터/시공업체/배송기사/관리자)이 공유하는 저장소.
 * localStorage에 저장하고, storage 이벤트 + 0.5초 폴링으로 모든 창에 실시간 반영한다.
 *
 * 핵심 설계 (v6 — 서비스 구조 재편):
 *  - 제조사(현대기아) 정책상 카마스터가 온라인으로 개별 영업(상담 예약)을 진행할 수 없어,
 *    "신차인도서비스"와 "신차 케어 서비스"를 완전히 독립된 두 서비스로 분리했다.
 *
 *  [신차인도서비스] 카마스터가 오프라인 상담 후 계약 내용을 앱에 1차 기록(계약등록)
 *    -> 고객이 확인(계약확정) -> 고객이 최종 수령지와 함께 출고 요청 -> 카마스터가 공장에 출고 의뢰.
 *    이후 배송 단계는 현대글로비스 신차배송조회 5단계를 기준으로 한 Enum(r.stage)으로 관리한다:
 *    READY(출고처리/준비) -> DISPATCHED(탁송사인수) -> IN_TRANSIT(탁송중, 필요 시 EXCEPTION으로
 *    수동 전환 가능) -> [destinationType이 AFFILIATED_SHOP(제휴 시공소 경유)이면: IN_TRANSIT(TO_SHOP) ->
 *    CUSTOMIZING(카마스터가 시공완료 확인) -> IN_TRANSIT(TO_DESTINATION)] -> DELIVERED(도착, 카마스터
 *    개인수령확인 + 고객 최종인수승인 양쪽이 모두 끝나야) -> CONFIRMED — 이 시점이 카마스터 역할의
 *    종료 지점이다(READY/DISPATCHED는 데모에서 출고 의뢰 즉시 완료 처리된다, requestRelease 참고).
 *    목적지 유형(destinationType: DEALERSHIP/AFFILIATED_SHOP/CUSTOM_ADDRESS)은 카마스터가 지정한
 *    협력업체에서 진행하는 옵션 작업(hasCustomizing, destinationType에서 파생) 여부를 포함해 오프라인
 *    계약 시점에 이미 정해지는 것이라 이 화면에서 다시 묻지 않는다.
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

// 기존 3개 샵은 이미 검증을 통과한 것으로 간주한다(verificationStatus: 'approved') — 신규 슬라이스인
// Shop 독립 레지스트리(4.3절) 도입 이전부터 있던 데모 시드 데이터이므로 소급 심사를 요구하지 않는다.
const DEFAULT_SHOPS = [
  { id: 'a', name: '울산 A샵', rating: 4.8, reviews: 127, count: 340, warranty: 12, hours: 3, tags: ['PPF 전문', '당일 시공'], priceAdj: 0, address: '울산광역시 남구 OO동 123-45', bonusPoint: 0, phone: '010-3333-4401',
    ownerUserId: null, groupIds: ['g_ulsan'], verificationStatus: 'approved', businessRegistrationNumber: '1234567890', businessRepresentativeName: '울산에이샵대표', businessStartDate: '2015-03-02', businessVerifiedAt: Date.now(), businessRegistrationDocUrl: '' },
  { id: 'b', name: '울산 B샵', rating: 4.6, reviews: 89, count: 210, warranty: 6, hours: 4, tags: ['넓은 주차공간', '대차 지원'], priceAdj: 0, address: '울산광역시 중구 OO동 45-6', bonusPoint: 0, phone: '010-3333-4402',
    ownerUserId: null, groupIds: ['g_ulsan'], verificationStatus: 'approved', businessRegistrationNumber: '2234567890', businessRepresentativeName: '울산비샵대표', businessStartDate: '2017-07-11', businessVerifiedAt: Date.now(), businessRegistrationDocUrl: '' },
  { id: 'c', name: '울산 C샵', rating: 4.9, reviews: 56, count: 98, warranty: 12, hours: 3, tags: ['최고 평점', '신생 인증점'], priceAdj: 40000, address: '울산광역시 남구 OO동 88-1', bonusPoint: 0, phone: '010-3333-4403',
    ownerUserId: null, groupIds: ['g_ulsan'], verificationStatus: 'approved', businessRegistrationNumber: '3234567890', businessRepresentativeName: '울산씨샵대표', businessStartDate: '2022-01-20', businessVerifiedAt: Date.now(), businessRegistrationDocUrl: '' },
];

const DEFAULT_KARMASTERS = [
  { id: 'k1', name: '김도현 카마스터', nickname: '도현매니저', nameDisplayMode: 'nickname', rating: 4.9, reviews: 212, groupIds: ['g_ulsan'], tags: ['출고 전문', '리퍼럴 인증'], preferredShopId: 'a', pin: '1111', phone: '010-2222-3301', bonusPoint: 0 },
  { id: 'k2', name: '박서연 카마스터', nickname: '서연카마스터', nameDisplayMode: 'nickname', rating: 4.7, reviews: 154, groupIds: ['g_ulsan'], tags: ['신속 상담'], preferredShopId: 'c', pin: '2222', phone: '010-2222-3302', bonusPoint: 0 },
  { id: 'k3', name: '이준호 카마스터', nickname: '준호쓰카', nameDisplayMode: 'nickname', rating: 4.95, reviews: 301, groupIds: ['g_busan', 'g_ulsan'], tags: ['VIP 응대', '리퍼럴 인증'], preferredShopId: 'b', pin: '3333', phone: '010-2222-3303', bonusPoint: 0 },
];

// Group(그룹/커뮤니티) 카탈로그 — user-account-role-model-spec.md 1.3절. type은 참고용 분류일 뿐 엄격한
// 단일 enum이 아니다(하나의 그룹이 여러 성격을 동시에 가질 수 있음). 실제 서비스라면 슈퍼바이저가
// 운영 중 계속 늘려가는 카탈로그이므로, 여기 seed는 최소 예시일 뿐이다.
const DEFAULT_GROUPS = [
  { groupId: 'g_ulsan', name: '울산', type: 'region', description: '울산광역시 권역', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_busan', name: '부산', type: 'region', description: '부산광역시 권역', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_gyeonggi', name: '경기', type: 'region', description: '경기 권역', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_import_dealer', name: '수입차 딜러 커뮤니티', type: 'community', description: '수입차 판매 관련 정보 교류 커뮤니티', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_ev_service', name: '전기차 정비 네트워크', type: 'industry', description: '전기차 정비·서비스 전문 네트워크', createdBy: 'system', createdAt: Date.now() },
];

const DEFAULT_DRIVERS = [
  { id: 'd1', name: '최기사', phone: '010-4444-5501' },
  { id: 'd2', name: '정기사', phone: '010-4444-5502' },
];

// 관리자 세분화 — user-account-role-model-spec.md 1.3/4.5/7장. 슈퍼바이저는 전체 플랫폼, 커뮤니티관리자는
// assignedGroupIds에 배정된 Group(들)로 조회·승인 범위가 제한된다.
const DEFAULT_ADMINS = [
  { id: 'admin_super', name: '박총괄 슈퍼바이저', adminScope: 'super', assignedGroupIds: [], phone: '010-9000-0001' },
  { id: 'admin_ulsan', name: '이지역 커뮤니티관리자', adminScope: 'community', assignedGroupIds: ['g_ulsan'], phone: '010-9000-0002' },
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

// 지연 사유 코드 표준셋 — 현대글로비스는 물론 업계 전반에 공개된 표준이 없어(택배 표준약관 등 조사 결과),
// new-car-delivery-tracking-ui-items-spec.md 2.2절의 자체 제정 v1 잠정안을 그대로 채택한다.
const DELAY_REASON_OPTIONS = [
  { code: 'traffic', label: '교통정체' },
  { code: 'weather', label: '기상악화' },
  { code: 'vehicle_issue', label: '차량 정비·고장' },
  { code: 'accident', label: '교통사고' },
  { code: 'dispatch_delay', label: '탁송사·기사 배정 지연' },
  { code: 'customer_schedule', label: '고객 일정 변경 요청' },
  { code: 'paperwork', label: '서류·행정 처리 지연' },
  { code: 'peak_season', label: '성수기 물량 폭주' },
  { code: 'other', label: '기타' },
];
function delayReasonLabel(code) { const f = DELAY_REASON_OPTIONS.find(o => o.code === code); return f ? f.label : ''; }

// 목적지 유형(DestinationType, 탁송 계약 시점 확정) — new-car-delivery-tracking-service-spec.md 4.1절.
// hasCustomizing(구 needsService)은 별도 필드로 저장하지 않고 destinationType에서 파생시킨다 — 두 값이
// 어긋날 일이 애초에 없도록(AFFILIATED_SHOP일 때만 커스터마이징을 거친다는 게 정의 그 자체이므로).
const DESTINATION_TYPE_OPTIONS = [
  { code: 'DEALERSHIP', label: '영업소 직행' },
  { code: 'AFFILIATED_SHOP', label: '제휴 시공소 경유(커스터마이징)' },
  { code: 'CUSTOM_ADDRESS', label: '고객 지정 장소로 배송' },
];
function destinationTypeLabel(t) { const f = DESTINATION_TYPE_OPTIONS.find(o => o.code === t); return f ? f.label : '미정'; }
function hasCustomizing(r) { return !!(r && r.destinationType === 'AFFILIATED_SHOP'); }

// ---- 카마스터 표시 이름(닉네임/실명) — user-account-role-model-spec.md 3장/4.2/5장 ----
// brandsHandled[]는 별도 필드로 저장하지 않고, 그 카마스터가 담당한 계약들의 carBrand에서 매번
// 계산한다(v1.7 "자동 유추가 기본값" 원칙 — 다만 본인이 수동으로 덮어쓰는 기능까지는 구현하지 않았다).
function brandsHandledFor(karmasterId) {
  const reservations = (window.Store ? window.Store.getReservationsByKarmaster(karmasterId) : []);
  const brands = new Set();
  reservations.forEach(r => { if (r.carBrand) brands.add(r.carBrand); });
  return Array.from(brands);
}
// hyundai_kia(현대/기아 소속) / other(그 외 브랜드) / none(연결된 계약 없음) — brandsHandled에서 파생.
function brandAffiliationFor(karmasterId) {
  const brands = brandsHandledFor(karmasterId);
  if (!brands.length) return 'none';
  return (brands.includes('현대') || brands.includes('기아')) ? 'hyundai_kia' : 'other';
}
// 고객 화면에 노출할 카마스터 표시명 — hyundai_kia 소속이면 nameDisplayMode를 무시하고 닉네임으로
// 강제한다(제조사 정책, 5장). 이 강제 대상인데 닉네임이 아직 없으면(실제 서비스라면 가입 시 필수
// 설정이지만, 이 MVP의 온보딩 폼은 닉네임 입력을 아직 받지 않는다) 실명으로 새지 않도록 마스킹된
// 전화번호로 대체한다 — 반면 강제 대상이 아닌 카마스터가 그냥 아직 닉네임을 안 정한 경우는 보호해야
// 할 정책이 없으므로 실명을 그대로 보여준다(데모 편의).
function karmasterDisplayName(k) {
  if (!k) return '카마스터';
  const forced = brandAffiliationFor(k.id) === 'hyundai_kia';
  const mode = forced ? 'nickname' : (k.nameDisplayMode || 'nickname');
  if (mode === 'real_name') return k.name;
  if (k.nickname && k.nickname.trim()) return k.nickname;
  return forced ? (window.Store ? window.Store.maskPhone(k.phone) : k.name) : k.name;
}

// ---- 관리자 스코프 필터링 — user-account-role-model-spec.md 1.3절 "오더의 스코프는 처리하는
// 카마스터/시공업체가 어느 Group에 속해 있는가로 정해진다" ----
// 슈퍼바이저(adminScope: 'super')는 항상 전체를 본다. 커뮤니티관리자는 배정된 assignedGroupIds와
// 겹치는 Group에 속한 카마스터/시공업체가 처리하는 건만 볼 수 있다 — 아직 카마스터/시공업체가
// 배정되지 않은 건(예: 고객요청 단계에서 미등록 카마스터 지정)은 스코프가 정해지지 않았으므로
// 커뮤니티관리자에게는 보이지 않는다(슈퍼바이저만 볼 수 있다).
function reservationInAdminScope(r, admin) {
  if (!admin || admin.adminScope !== 'community') return true;
  const km = window.Store ? window.Store.getKarmaster(r.karmasterId) : null;
  if (!km) return false;
  return (km.groupIds || []).some(gid => (admin.assignedGroupIds || []).includes(gid));
}
function careOrderInAdminScope(c, admin) {
  if (!admin || admin.adminScope !== 'community') return true;
  const shop = window.Store ? window.Store.getShop(c.shopId) : null;
  if (!shop) return false;
  return (shop.groupIds || []).some(gid => (admin.assignedGroupIds || []).includes(gid));
}
function shopInAdminScope(s, admin) {
  if (!admin || admin.adminScope !== 'community') return true;
  return (s.groupIds || []).some(gid => (admin.assignedGroupIds || []).includes(gid));
}

// Layer 2(매니저 보강) 데이터 구조. 원칙(service-spec.md 3.2/7장): 텍스트성 필드(ETA/위치코멘트/지연사유/
// 공정현황)는 "초안 저장" 시점에는 고객에게 반영되지 않고, "게시" 액션을 거쳐야 published로 넘어간다.
// 사진(인수 완료/커스터마이징 현장)만 예외로 업로드 즉시 게시되며 회수(내리기)만 제공한다.
// 기사 성명/연락처·내부 특이사항 메모는 애초에 게시 대상이 아닌 내부 전용 필드라 draft에만 존재한다.
function _emptyAugmentation() {
  return {
    draft: { driverName: '', driverPhone: '', eta: '', locationNote: '', delayReasonCode: '', delayReasonNote: '', customizingProgress: '', internalMemo: '' },
    published: { eta: '', locationNote: '', delayReasonCode: '', delayReasonNote: '', customizingProgress: '', publishedAt: null },
    deliveryPhotos: [], // 인수 완료 사진 { src, label, uploadedAt, withdrawn }
    customizingPhotos: [], // 커스터마이징 현장 사진 (같은 구조)
    auditLog: [], // { t, action, detail } — 게시/회수 이력
  };
}

function _emptyStore() {
  return { reservations: [], careOrders: [], shops: DEFAULT_SHOPS, karmasters: DEFAULT_KARMASTERS, drivers: DEFAULT_DRIVERS, groups: DEFAULT_GROUPS, admins: DEFAULT_ADMINS, seq: 0, careSeq: 0, pointWallets: {}, ratings: [], users: [], unclaimedKarmasters: [] };
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
    if (!this._cache.admins) this._cache.admins = DEFAULT_ADMINS;
    if (!this._cache.groups) this._cache.groups = DEFAULT_GROUPS;
    if (!this._cache.pointWallets) this._cache.pointWallets = {};
    if (!this._cache.ratings) this._cache.ratings = [];
    if (!this._cache.users) this._cache.users = [];
    if (!this._cache.unclaimedKarmasters) this._cache.unclaimedKarmasters = [];
    this._tick(this._cache);
    return this._cache;
  },

  // 배송 타이머가 만료된 건(신차인도서비스 예약 + 신차 케어 서비스 주문 각각 독립적으로)을 자동으로
  // "도착" 처리하고, 중간에 통과한 위치 체크포인트도 시간과 함께 이력(log)에 기록한다.
  _tick(data) {
    let changed = false;
    (data.reservations || []).forEach(r => {
      if (!r.transit || !r.transit.active) return;
      if (r.stage === 'EXCEPTION') return; // 지연/예외 상태에서는 배송 시계를 멈춘다 — 매니저가 재개해야 다시 진행된다
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
    r.transitStage = 'NONE';
    if (legKind === 'to_shop') {
      r.log = (r.log || []).concat([{ t: Date.now(), msg: `차량이 지정업체(${dest})에 도착했습니다 — 카마스터의 시공완료 확인 대기 (CUSTOMIZING)` }]);
      r.stage = 'CUSTOMIZING';
      return;
    }
    r.log = (r.log || []).concat([{ t: Date.now(), msg: `도착 완료 — ${dest} (DELIVERED)` }]);
    r.stage = 'DELIVERED';
    r.deliveredAt = Date.now();
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
  // 승인된(verificationStatus: 'approved') 업체만 — 고객에게 노출되는 목록은 항상 이걸 써야 한다
  // (user-account-role-model-spec.md 4.3절: "승인 전에는 고객에게 노출되지 않는다"). 레거시 필드가 없는
  // 레코드(verificationStatus undefined)는 이 필드가 생기기 전부터 있던 데이터이므로 승인된 것으로 본다.
  getApprovedShops() { return this.load().shops.filter(s => !s.verificationStatus || s.verificationStatus === 'approved'); },
  getShop(id) { return this.load().shops.find(s => s.id === id) || null; },
  getShopByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().shops.find(s => (s.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  // ---- 시공업체(Shop) 독립 레지스트리 — 신규 등록·승인 워크플로 (user-account-role-model-spec.md 4.3절) ----
  // 실제 국세청 "사업자등록정보 진위확인" Open API는 이 데모에서 호출할 수 없으므로, 형식 검증(10자리
  // 사업자등록번호)과 필수값 입력 여부만으로 통과/실패를 시뮬레이션한다 — 실패 사유 문구에 "데모
  // 시뮬레이션"임을 명시해 실제 API 연동으로 오인하지 않도록 한다.
  registerShop({ name, phone, businessRegistrationNumber, businessRepresentativeName, businessStartDate, businessRegistrationDocUrl, groupIds }) {
    const bn = (businessRegistrationNumber || '').replace(/[^0-9]/g, '');
    if (bn.length !== 10) return { error: 'FORMAT', message: '사업자등록번호는 숫자 10자리여야 합니다.' };
    if (!(businessRepresentativeName || '').trim() || !(businessStartDate || '').trim()) {
      return { error: 'VERIFY_FAILED', message: '사업자등록정보 진위확인에 실패했습니다(데모 시뮬레이션) — 대표자성명과 개업일자를 정확히 입력해 주세요.' };
    }
    const data = this.load();
    data.shops = data.shops || [];
    const dup = data.shops.find(s => s.businessRegistrationNumber === bn && ['pending', 'approved'].includes(s.verificationStatus));
    if (dup) return { error: 'DUPLICATE', message: '이미 등록된 사업자입니다.' };
    const shop = {
      id: 's' + Date.now(), name: (name || '').trim(), phone: phone || '',
      rating: 0, reviews: 0, count: 0, warranty: 0, hours: 0, tags: [], priceAdj: 0, address: '', bonusPoint: 0,
      ownerUserId: null, groupIds: (groupIds || []).slice(),
      verificationStatus: 'pending',
      businessRegistrationNumber: bn, businessRepresentativeName: (businessRepresentativeName || '').trim(),
      businessStartDate, businessVerifiedAt: Date.now(), businessRegistrationDocUrl: businessRegistrationDocUrl || '',
    };
    data.shops.push(shop);
    this.save(data);
    this.touchUserRole(phone, businessRepresentativeName, 'shop');
    return { shop };
  },
  approveShop(id) {
    const data = this.load();
    const idx = (data.shops || []).findIndex(s => s.id === id);
    if (idx === -1) return null;
    data.shops[idx] = Object.assign({}, data.shops[idx], { verificationStatus: 'approved' });
    this.save(data);
    return data.shops[idx];
  },
  rejectShop(id) {
    const data = this.load();
    const idx = (data.shops || []).findIndex(s => s.id === id);
    if (idx === -1) return null;
    data.shops[idx] = Object.assign({}, data.shops[idx], { verificationStatus: 'rejected' });
    this.save(data);
    return data.shops[idx];
  },

  getKarmasters() { return this.load().karmasters; },
  getKarmaster(id) { return this.load().karmasters.find(k => k.id === id) || null; },
  getKarmasterByPin(pin) { return this.load().karmasters.find(k => k.pin === pin) || null; },
  getKarmasterByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().karmasters.find(k => (k.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  // ---- 카마스터 표시 이름(닉네임/실명) — user-account-role-model-spec.md 3장/4.2절 ----
  // 닉네임 전역 유일성은 이 데모에서는 카마스터끼리만 비교한다(User.nickname과의 전체 통합은 범위 밖).
  // 대소문자·공백을 정규화한 뒤 비교한다.
  isKarmasterNicknameTaken(nickname, excludeId) {
    const norm = (nickname || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!norm) return false;
    return this.load().karmasters.some(k => k.id !== excludeId && (k.nickname || '').trim().toLowerCase().replace(/\s+/g, '') === norm);
  },
  setKarmasterProfile(id, { nickname, nameDisplayMode }) {
    const data = this.load();
    const idx = data.karmasters.findIndex(k => k.id === id);
    if (idx === -1) return null;
    const patch = {};
    if (nickname !== undefined) patch.nickname = (nickname || '').trim();
    if (nameDisplayMode !== undefined) patch.nameDisplayMode = nameDisplayMode;
    data.karmasters[idx] = Object.assign({}, data.karmasters[idx], patch);
    this.save(data);
    return data.karmasters[idx];
  },
  getDrivers() { return this.load().drivers; },
  getDriverByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().drivers.find(d => (d.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },

  // ---- 관리자(슈퍼바이저/커뮤니티관리자) — user-account-role-model-spec.md 4.5/7장 ----
  getAdmins() { return this.load().admins; },
  getAdmin(id) { return this.load().admins.find(a => a.id === id) || null; },
  getAdminByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().admins.find(a => (a.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },

  // ---- 통합 사용자(User) — "한 사람 = 하나의 계정 + 여러 역할 속성" (user-account-role-model-spec.md 1.1/3장) ----
  // 전화번호를 공통 식별자로 삼아, 구매자/카마스터/시공업체/배송기사 중 어느 역할로 로그인하거나 최초로
  // 그 역할이 발생(예: 구매자는 최초 계약 등록 시점)해도 같은 User 아래 역할 속성(roleAttributes)이
  // 쌓이도록 한다 — 카마스터가 개인적으로 신차를 구매하면 같은 전화번호 아래 karmaster+customer 속성이
  // 함께 존재하는 식으로 "겸임(상호주의)"을 자연스럽게 표현한다. 이 MVP에서는 실명 인증·OTP·역할별
  // 세부 데이터(Group/Shop 레지스트리 등)까지는 구현하지 않고, 식별자 통합과 역할 속성 누적만 다룬다.
  touchUserRole(phone, name, role) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    const data = this.load();
    data.users = data.users || [];
    let u = data.users.find(x => (x.phone || '').replace(/[^0-9]/g, '') === norm);
    if (!u) {
      u = { userId: 'u' + Date.now() + Math.floor(Math.random() * 1000), phone, name: name || '', nickname: '', createdAt: Date.now(), roleAttributes: [] };
      data.users.push(u);
    } else if (name && !u.name) {
      u.name = name; // 구매자 로그인처럼 이름이 매번 함께 오는 경로에서, 아직 이름이 비어 있으면 채워준다
    }
    if (!u.roleAttributes.some(ra => ra.role === role)) {
      u.roleAttributes.push({ role, active: true, attachedAt: Date.now() });
    }
    this.save(data);
    return u;
  },
  getUserByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return (this.load().users || []).find(x => (x.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  getUsers() { return (this.load().users || []).slice().sort((a, b) => b.createdAt - a.createdAt); },
  // 전화번호 뒷자리를 마스킹한 표시용 문자열 — 미가입 카마스터는 본인이 정한 닉네임이 없으므로, 고객이
  // 이미 전화번호로 그 사람을 인지하는 흐름과 자연스럽게 이어지도록 이 형태로만 표시한다(4.2절).
  maskPhone(phone) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (digits.length !== 11) return phone || '';
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-**${digits.slice(9)}`;
  },

  // ---- 미가입 카마스터 평판 레코드(UnclaimedKarmasterProfile) — user-account-role-model-spec.md 4.2절 ----
  // User/roleAttribute와 같은 테이블에 합치지 않고 완전히 분리해서 관리한다 — 나중에 실제 가입할 때
  // phone 유일성 제약이나 가입일 같은 의미가 꼬이는 걸 피하기 위해서다. 고객이 아직 등록되지 않은
  // 카마스터의 전화번호로 계약을 등록하는 순간 생성되고, 그 카마스터가 실제로 가입하면(온보딩)
  // linkedUserId가 채워져 "이관 완료" 표시가 된다 — 레코드 자체는 지우지 않고 이력으로 남긴다.
  touchUnclaimedKarmaster(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    const data = this.load();
    data.unclaimedKarmasters = data.unclaimedKarmasters || [];
    let u = data.unclaimedKarmasters.find(x => (x.phone || '').replace(/[^0-9]/g, '') === norm);
    if (!u) {
      u = { id: 'uk' + Date.now() + Math.floor(Math.random() * 1000), phone, rating: 0, reviews: 0, firstSeenAt: Date.now(), linkedUserId: null, linkedAt: null };
      data.unclaimedKarmasters.push(u);
      this.save(data);
    }
    return u;
  },
  getUnclaimedKarmasterByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return (this.load().unclaimedKarmasters || []).find(x => (x.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  // 검색 화면 등 "아직 가입하지 않은 사람"만 보여줘야 하는 곳에서 쓴다 — 이미 가입해 실제 카마스터로
  // 연동된(linkedUserId가 채워진) 레코드는 이제 일반 카마스터 목록 쪽에서 보여지므로 여기서는 뺀다.
  getUnclaimedKarmasters() { return (this.load().unclaimedKarmasters || []).filter(u => !u.linkedUserId); },

  // ---- Group(그룹/커뮤니티) 카탈로그 (user-account-role-model-spec.md 1.3절) ----
  // 그룹 생성은 슈퍼바이저만 할 수 있다는 원칙만 UI 쪽에서 지키면 되고(이 데모에서는 관리자 계정이
  // 슈퍼바이저를 겸한다), 카마스터/시공업체가 카탈로그에서 그룹을 고르는 것 자체는 승인이 필요 없다.
  getGroups() { return (this.load().groups || []).slice(); },
  getGroup(id) { return (this.load().groups || []).find(g => g.groupId === id) || null; },
  createGroup({ name, type, description }, createdByUserId) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const data = this.load();
    data.groups = data.groups || [];
    const group = { groupId: 'g' + Date.now(), name: trimmed, type: type || 'region', description: (description || '').trim(), createdBy: createdByUserId || 'admin', createdAt: Date.now() };
    data.groups.push(group);
    this.save(data);
    return group;
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
  //    (예: "이 앱으로 계약 관리하고 싶어요, 아래 번호로 확인해주세요"). 카마스터는 전화번호+계약번호+
  //    조회번호로 가입 없이 그 계약을 확인·승인할 수 있다 (approveContractAsUnregistered).
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
  startContractRequest({ karmasterPhone, customer, carModel, carBrand, contractNumber, trim, color, contractDate }) {
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
      carModel: carModel || '', carBrand: carBrand || '', contractNumber: contractNumber || '', trim: trim || '', color: color || '', contractDate: contractDate || '', // carBrand: 카마스터의 brandsHandled[] 자동 유추(4.2절)에 쓰인다. contractNumber: 제조사/딜러 발급 실제 계약번호 — 이 앱이 자동 채번하는 id(접수번호)와 별개이며, Layer 1(제조사 실주행 트래킹) 연동 시 브랜드+계약번호+계약자명 3종 식별 키의 일부가 된다(service-spec 2.1절)
      destinationType: null, // 'DEALERSHIP' | 'AFFILIATED_SHOP' | 'CUSTOM_ADDRESS' — 탁송 계약 시점(카마스터 승인 시) 확정
      consultMemo: '',
      karmasterShopName: '', // 카마스터가 지정한 협력업체명(선택) — 카마스터-업체 간 별개 거래라 고객은 관여하지 않는다
      ownerReleaseRequested: false, // 고객이 "이제 차를 받고 싶다"고 먼저 요청해야 카마스터가 출고를 의뢰할 수 있다
      deliveryAddress: '', // 최종 수령지 — 출고 요청 시점에 고객이 정한다(자택이든 별도 이용할 시공·정비업체든)
      transit: null,
      transitStage: 'NONE', // 'NONE' | 'TO_SHOP' | 'TO_DESTINATION' — IN_TRANSIT 상태 내 구간 구분
      isManagerConfirmed: false, // 카마스터 개인수령확인 (DELIVERED → CONFIRMED 게이트, 고객 확인과 양쪽 다 필요)
      isCustomerApproved: false, // 고객 최종인수승인 (DELIVERED → CONFIRMED 게이트)
      deliveredAt: null, // DELIVERED 전환 시각(도착 완료 시각) — ui-items-spec.md 1.2절 "인수 완료 시각"
      inspectionResult: null, // 'ok' | 'issue' — 고객 검수 결과
      inspectionNote: '', // 특이사항 메모(이슈발견 시 필수)
      customerPhotos: [], // 고객이 직접 촬영해 올린 사진(선택, 이슈 근거자료)
      signature: null, // 전자서명 이미지(dataURL) — [인수 확인] CTA와 함께 저장
      exceptionReason: '', exceptionPrevStage: null, exceptionPausedAt: null, // EXCEPTION 상태 관련 필드
      augmentation: _emptyAugmentation(), // Layer 2(매니저 보강 정보) — ETA/위치코멘트/지연사유/공정현황/인수·공정 사진
      karmasterRated: false,
      karmasterPointsEarned: 0,
      messages: [{ from: 'customer', text: noticeMsg, t: Date.now() }],
      karmasterUnread: true,
      log: [{ t: Date.now(), msg: km ? '고객이 계약내역을 등록했습니다 — 카마스터 승인 대기' : '고객이 미등록 카마스터를 지정해 계약내역을 등록 — 조회번호 발급 (등록 시 자동 연결)' }],
    };
    data.reservations.push(reservation);
    this.save(data);
    this.touchUserRole(customer.phone, customer.name, 'customer'); // 최초 계약 등록 시점에 customer 역할 속성 자동 부착
    if (!km && karmasterPhone) this.touchUnclaimedKarmaster(karmasterPhone); // 미가입 카마스터 평판 레코드 생성(4.2절)
    return reservation;
  },
  // 카마스터가 화면에 뜬 계약 내용(차량정보·계약일자·고객정보)을 검토하고 승인 — 이 시점부터 처리가
  // 실제로 시작된다. 차량정보는 고객이 이미 입력해뒀으므로 여기서는 목적지 유형·상담메모만 채운다.
  fillContractDetails(id, { destinationType, consultMemo, karmasterShopName }) {
    const r = this.getReservation(id);
    if (!r || r.stage !== '고객요청') return r;
    return this._update(id, { destinationType, consultMemo: consultMemo || '', karmasterShopName: karmasterShopName || '', stage: '계약등록' },
      `카마스터가 계약 내용을 검토하고 승인했습니다 — 차종: ${r.carModel}, 목적지 유형: ${destinationTypeLabel(destinationType)}`);
  },
  // 비가입자 로그인 — 전화번호+제조사 계약번호+조회번호 3개가 모두 일치해야 찾는다. 아직 카마스터가
  // 배정되지 않은 예약(전화번호는 pendingKarmasterPhone과 비교)과, 이미 이 경로로 승인까지 마쳤지만
  // 아직 정식 가입(비밀번호 발급)은 하지 않은 예약(전화번호는 배정된 카마스터의 phone과 비교) 둘 다
  // 대상이다 — 정식 가입한(pin 있는) 카마스터의 예약은 이 경로로 찾을 수 없다(전화번호+비밀번호로
  // 로그인해야 한다). 신차인도서비스가 이미 완료(CONFIRMED)된 예약은 만료된 것으로 취급해 제외한다.
  getReservationByPhoneContractCode({ phone, contractNumber, confirmCode }) {
    const p = (phone || '').replace(/[^0-9]/g, '');
    const cn = (contractNumber || '').trim().toLowerCase();
    const code = (confirmCode || '').trim();
    if (!p || !cn || !code) return null;
    const data = this.load();
    return data.reservations.find(r => {
      if (r.stage === 'CONFIRMED') return false;
      if ((r.contractNumber || '').trim().toLowerCase() !== cn) return false;
      if (r.confirmCode !== code) return false;
      if (r.karmasterId) {
        const km = data.karmasters.find(k => k.id === r.karmasterId);
        if (!km || km.pin) return false;
        return km.phone.replace(/[^0-9]/g, '') === p;
      }
      return (r.pendingKarmasterPhone || '').replace(/[^0-9]/g, '') === p;
    }) || null;
  },
  // 조회번호를 전달받지 못했거나 분실한 경우의 복구 경로 — 계약서 자체가 갖고 있는 정보(제조사
  // 계약번호+계약자명)만으로 조회번호를 다시 확인시켜 준다. 이 조합 자체가 실제 계약서를 갖고 있어야만
  // 맞출 수 있는 지문 역할을 하므로, 조회번호 방식과 동일한 수준의 검증이다. 브랜드는 선택적으로 한 번
  // 더 좁히는 용도일 뿐 필수는 아니다. 승인 전후 상관없이(단, 정식 가입 전·미완료 건만) 대상이 된다.
  getReservationByContractInfo({ contractNumber, customerName, carBrand }) {
    const cn = (contractNumber || '').trim().toLowerCase();
    const name = (customerName || '').trim();
    if (!cn || !name) return null;
    const data = this.load();
    return data.reservations.find(r => {
      if (r.stage === 'CONFIRMED') return false;
      if ((r.contractNumber || '').trim().toLowerCase() !== cn) return false;
      if ((r.customer.name || '').trim() !== name) return false;
      if (carBrand && r.carBrand !== carBrand) return false;
      if (r.karmasterId) {
        const km = data.karmasters.find(k => k.id === r.karmasterId);
        return !!km && !km.pin;
      }
      return true;
    }) || null;
  },
  // 미가입 카마스터가 전화번호+계약번호+조회번호로 본인 확인을 마친 뒤 계약을 승인한다. 가입(정식
  // 비밀번호 발급)은 여기서 강제하지 않는다 — 같은 전화번호로 미가입 상태로 처리한 카마스터 레코드가
  // 이미 있으면 재사용하고, 없으면 pin이 빈 가벼운 레코드를 새로 만든다.
  approveContractAsUnregistered(id, { name, groupIds, destinationType, consultMemo, karmasterShopName }) {
    const data = this.load();
    const idx = data.reservations.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const r = data.reservations[idx];
    if (r.stage !== '고객요청' || r.karmasterId) return r;
    let km = data.karmasters.find(k => k.phone === r.pendingKarmasterPhone && !k.pin);
    if (!km) {
      km = {
        id: 'k' + Date.now(), name, nickname: '', nameDisplayMode: 'nickname', rating: 0, reviews: 0, groupIds: (groupIds || []).slice(),
        tags: [], preferredShopId: null, pin: '', phone: r.pendingKarmasterPhone || '', bonusPoint: 0,
      };
      data.karmasters.push(km);
    }
    const updated = Object.assign({}, r, {
      karmasterId: km.id, pendingKarmasterPhone: '',
      destinationType, consultMemo: consultMemo || '', karmasterShopName: karmasterShopName || '', stage: '계약등록',
    });
    updated.log = (updated.log || []).concat([{ t: Date.now(), msg: `미가입 카마스터(${name})가 전화번호+계약번호+조회번호로 본인 확인 후 계약 내용을 승인 — 정식 가입은 아직 하지 않음` }]);
    data.reservations[idx] = updated;
    // 미가입 상태로 쌓여있던 평판 레코드가 있으면 카마스터로 이관한다 — 레코드 자체는 지우지 않고
    // linkedUserId/linkedAt만 채워 "이관 완료"로 표시한다(4.2절).
    const unclaimedIdx = (data.unclaimedKarmasters || []).findIndex(u => (u.phone || '').replace(/[^0-9]/g, '') === (km.phone || '').replace(/[^0-9]/g, '') && !u.linkedUserId);
    if (unclaimedIdx !== -1) {
      const unclaimed = data.unclaimedKarmasters[unclaimedIdx];
      if (unclaimed.reviews > 0) {
        const kIdx = data.karmasters.findIndex(k => k.id === km.id);
        if (kIdx !== -1) data.karmasters[kIdx] = Object.assign({}, data.karmasters[kIdx], { rating: unclaimed.rating, reviews: unclaimed.reviews });
      }
      data.unclaimedKarmasters[unclaimedIdx] = Object.assign({}, unclaimed, { linkedUserId: km.id, linkedAt: Date.now() });
    }
    this.save(data);
    this.touchUserRole(km.phone, name, 'karmaster');
    return updated;
  },
  // 정식 가입 — 조회번호와 무관한 새 비밀번호를 발급한다(같은 값을 재사용하면, 이미 남에게 전달된
  // 값이 영구 비밀번호가 되어버려 보안 의미가 약해진다). 발급 이후로는 전화번호+이 비밀번호가 그
  // 카마스터의 모든 계약(과거·미래 전부)에 대한 로그인 수단이 되고, 조회번호는 더 이상 쓰이지 않는다.
  registerKarmasterPassword(karmasterId) {
    const data = this.load();
    const idx = data.karmasters.findIndex(k => k.id === karmasterId);
    if (idx === -1) return null;
    const password = this._genCode();
    data.karmasters[idx] = Object.assign({}, data.karmasters[idx], { pin: password });
    this.save(data);
    return password;
  },
  // "빠른 로그인"과 같은 성격의 테스트 편의 — 실제로는 고객이 카마스터에게 전화번호+계약번호+조회번호를
  // 직접 전달해야 하는데, 데모/테스트 중에는 그걸 전달할 방법이 없다. 고정된 데모용 전화번호로 아직
  // 유효한(미완료·미가입) 예약이 있으면 그대로 재사용하고, 없으면 새로 하나 만들어 그 값을 돌려준다 —
  // 카마스터 화면의 "비가입자 로그인"을 클릭 한 번으로 바로 체험해볼 수 있게 한다.
  getOrCreateUnregisteredDemo() {
    const demoPhone = '010-9000-1234';
    const data = this.load();
    const existing = data.reservations.find(r => {
      if (r.stage === 'CONFIRMED') return false;
      if (r.karmasterId) {
        const km = data.karmasters.find(k => k.id === r.karmasterId);
        return !!km && !km.pin && km.phone === demoPhone;
      }
      return r.pendingKarmasterPhone === demoPhone;
    });
    if (existing) return { phone: demoPhone, contractNumber: existing.contractNumber, confirmCode: existing.confirmCode };
    const r = this.startContractRequest({
      karmasterPhone: demoPhone,
      customer: { name: '예시고객', phone: '010-1000-2000', nickname: '' },
      carModel: '예시카', carBrand: '기타', contractNumber: 'DEMO-' + String(Math.floor(1000 + Math.random() * 9000)),
      trim: '', color: '', contractDate: new Date().toISOString().slice(0, 10),
    });
    return { phone: demoPhone, contractNumber: r.contractNumber, confirmCode: r.confirmCode };
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
      carModel: '', carBrand: '', contractNumber: '', trim: '', color: '', contractDate: '',
      destinationType: null,
      consultMemo: '',
      karmasterShopName: '',
      ownerReleaseRequested: false,
      deliveryAddress: '',
      transit: null,
      transitStage: 'NONE',
      isManagerConfirmed: false,
      isCustomerApproved: false,
      deliveredAt: null,
      inspectionResult: null,
      inspectionNote: '',
      customerPhotos: [],
      signature: null,
      exceptionReason: '', exceptionPrevStage: null, exceptionPausedAt: null,
      augmentation: _emptyAugmentation(),
      karmasterRated: false,
      karmasterPointsEarned: 0,
      messages: [],
      karmasterUnread: false,
      log: [{ t: Date.now(), msg: '관리자가 계약을 대리 등록했습니다 (고객요청·카마스터 승인 절차 생략)' }],
    }, partial);
    data.reservations.push(reservation);
    this.save(data);
    if (reservation.customer && reservation.customer.phone) this.touchUserRole(reservation.customer.phone, reservation.customer.name, 'customer');
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
    // 현대글로비스 실제 5단계 중 READY(출고처리/준비)·DISPATCHED(탁송사인수)는 데모에서는 출고 의뢰
    // 시점에 즉시 완료된 것으로 처리한다(둘 다 이력에는 남긴다) — 그래야 기존 v5 타이밍(요청 즉시
    // 배송 시작)과 호환되어 실시간 배송 시뮬레이션이 곧바로 IN_TRANSIT부터 시작될 수 있다.
    const preLog = [
      { t: Date.now(), msg: '출고 처리 완료 (READY)' },
      { t: Date.now(), msg: '탁송사가 인수해 기사를 배정했습니다 (DISPATCHED)' },
    ];
    // destinationType이 AFFILIATED_SHOP(제휴 시공소 경유)이면 최종 목적지 전에 카마스터 지정업체를 먼저
    // 들른다 — 이건 카마스터와 업체 사이의 별개 거래라 고객은 관여하지 않고, 오너 수령확인 게이트로
    // 바로 이어지지 않는다 (_arriveReservation의 legKind==='to_shop' 분기 참고).
    if (hasCustomizing(r)) {
      const shopLabel = r.karmasterShopName || '지정업체';
      return this._update(id, {
        stage: 'IN_TRANSIT', transitStage: 'TO_SHOP',
        transit: this._buildTransit(shopLabel, CHECKPOINTS_FROM_FACTORY, 'to_shop'),
        log: (r.log || []).concat(preLog),
      }, `카마스터가 공장에 출고를 의뢰했습니다 — 탁송 시작(IN_TRANSIT), 1차 목적지: ${shopLabel}`);
    }
    const destination = r.deliveryAddress || '고객 지정 수령지';
    return this._update(id, {
      stage: 'IN_TRANSIT', transitStage: 'TO_DESTINATION',
      transit: this._buildTransit(destination, CHECKPOINTS_FROM_FACTORY, 'to_owner'),
      log: (r.log || []).concat(preLog),
    }, `카마스터가 공장에 출고를 의뢰했습니다 — 탁송 시작(IN_TRANSIT), 목적지: ${destination}`);
  },
  // 카마스터가 지정업체와 소통해 시공완료를 확인 — 고객·신차 케어 서비스와 무관한 카마스터-업체 간
  // 별개 거래이므로, 이 확인은 오직 카마스터만 할 수 있고 최종 목적지로의 재배송을 직접 시작시킨다.
  confirmKarmasterShopDone(id) {
    const r = this.getReservation(id);
    if (!r || r.stage !== 'CUSTOMIZING') return r;
    const destination = r.deliveryAddress || '고객 지정 수령지';
    return this._update(id, { stage: 'IN_TRANSIT', transitStage: 'TO_DESTINATION', transit: this._buildTransit(destination, CHECKPOINTS_FROM_SHOP, 'to_owner') },
      `카마스터가 지정업체 시공완료를 확인했습니다 — 최종 목적지로 재배송 시작 (IN_TRANSIT): ${destination}`);
  },
  // ---- 배송 지연/예외(EXCEPTION) — 매니저(카마스터)가 확인했을 때만 수동으로 전환 ----
  // 예외 상태인 동안은 _tick의 자동 도착 처리를 멈춘다(위 참고). 재개 시에는 그동안 흐른 시간만큼
  // transit의 시작시각을 뒤로 밀어, 예외 처리 중 시간이 실제로 "멈춰 있었던 것"처럼 보정한다.
  markException(id, reason) {
    const r = this.getReservation(id);
    if (!r || !['IN_TRANSIT', 'CUSTOMIZING'].includes(r.stage)) return r;
    const msg = (reason || '').trim() || '(사유 미입력)';
    return this._update(id, { exceptionPrevStage: r.stage, exceptionReason: msg, exceptionPausedAt: Date.now(), stage: 'EXCEPTION' },
      `⚠ 배송 지연/예외 상태로 전환 (EXCEPTION) — 사유: ${msg}`);
  },
  clearException(id) {
    const data = this.load();
    const idx = data.reservations.findIndex(x => x.id === id);
    if (idx === -1) return null;
    const r = data.reservations[idx];
    if (r.stage !== 'EXCEPTION') return r;
    const pauseMs = Math.max(0, Date.now() - (r.exceptionPausedAt || Date.now()));
    const updated = Object.assign({}, r, { stage: r.exceptionPrevStage || 'IN_TRANSIT', exceptionPrevStage: null, exceptionReason: '', exceptionPausedAt: null });
    if (updated.transit && updated.transit.active) updated.transit = Object.assign({}, updated.transit, { startedAt: updated.transit.startedAt + pauseMs });
    updated.log = (updated.log || []).concat([{ t: Date.now(), msg: '정상 운행으로 복귀했습니다 (예외 해제)' }]);
    data.reservations[idx] = updated;
    this.save(data);
    return updated;
  },

  // ---- Layer 2: 매니저 보강 정보 (ETA/위치코멘트/지연사유/커스터마이징 공정현황 + 인수·공정 사진) ----
  // 레거시 레코드(이 필드가 생기기 전에 만들어진 예약) 대비 안전한 기본값을 돌려준다.
  getAugmentation(r) { return (r && r.augmentation) || _emptyAugmentation(); },
  // "초안 저장" — 고객 화면에는 반영되지 않는다. 매 입력마다가 아니라 저장 버튼을 눌렀을 때만 호출된다
  // (karmaster.js가 타이핑 중에는 로컬 변수에만 담아두고, 저장/게시 시점에만 이 메서드를 호출한다).
  saveAugmentationDraft(id, patch) {
    const r = this.getReservation(id);
    if (!r) return r;
    const aug = Object.assign({}, this.getAugmentation(r));
    aug.draft = Object.assign({}, aug.draft, patch);
    return this._update(id, { augmentation: aug }, '매니저가 배송 보강 정보를 초안 저장했습니다 (미게시)');
  },
  // "게시하기" — 전달된 draftPatch를 먼저 초안에 반영한 뒤, 텍스트성 필드(ETA/위치코멘트/지연사유/공정현황)만
  // published로 복사한다. 기사 성명·연락처·내부 메모는 원칙적으로 게시 대상이 아니라 draft에만 남는다.
  publishAugmentation(id, draftPatch) {
    const r = this.getReservation(id);
    if (!r) return r;
    const aug = Object.assign({}, this.getAugmentation(r));
    aug.draft = Object.assign({}, aug.draft, draftPatch || {});
    const d = aug.draft;
    aug.published = Object.assign({}, aug.published, {
      eta: d.eta, locationNote: d.locationNote, delayReasonCode: d.delayReasonCode, delayReasonNote: d.delayReasonNote,
      customizingProgress: d.customizingProgress, publishedAt: Date.now(),
    });
    aug.auditLog = (aug.auditLog || []).concat([{ t: Date.now(), action: '게시', detail: 'ETA/위치코멘트/지연사유/공정현황 텍스트 게시' }]);
    return this._update(id, { augmentation: aug }, '매니저가 배송 보강 정보를 게시했습니다 — 고객 화면에 반영됨');
  },
  // 인수 완료 사진 / 커스터마이징 현장 사진 — 텍스트 정보와 달리 게시 게이트 없이 업로드 즉시 게시되고,
  // 회수(내리기)만 가능하다(service-spec.md 3.2절 예외 원칙). 최대 6장.
  _addPhoto(id, field, dataUrl, label) {
    const r = this.getReservation(id);
    if (!r) return r;
    const aug = Object.assign({}, this.getAugmentation(r));
    const photos = (aug[field] || []).slice();
    if (photos.filter(p => !p.withdrawn).length >= 6) return r;
    photos.push({ src: dataUrl, label: label || `사진 ${photos.length + 1}`, uploadedAt: Date.now(), withdrawn: false });
    aug[field] = photos;
    const logLabel = field === 'deliveryPhotos' ? '인수 완료 사진' : '커스터마이징 현장 사진';
    return this._update(id, { augmentation: aug }, `${logLabel} 업로드 (즉시 게시)`);
  },
  _withdrawPhoto(id, field, idx) {
    const r = this.getReservation(id);
    if (!r) return r;
    const aug = Object.assign({}, this.getAugmentation(r));
    const photos = (aug[field] || []).slice();
    if (!photos[idx] || photos[idx].withdrawn) return r;
    photos[idx] = Object.assign({}, photos[idx], { withdrawn: true });
    aug[field] = photos;
    aug.auditLog = (aug.auditLog || []).concat([{ t: Date.now(), action: '사진 회수', detail: photos[idx].label }]);
    const logLabel = field === 'deliveryPhotos' ? '인수 완료 사진' : '커스터마이징 현장 사진';
    return this._update(id, { augmentation: aug }, `${logLabel} 회수: ${photos[idx].label}`);
  },
  addDeliveryPhoto(id, dataUrl, label) { return this._addPhoto(id, 'deliveryPhotos', dataUrl, label); },
  withdrawDeliveryPhoto(id, idx) { return this._withdrawPhoto(id, 'deliveryPhotos', idx); },
  addCustomizingPhoto(id, dataUrl, label) { return this._addPhoto(id, 'customizingPhotos', dataUrl, label); },
  withdrawCustomizingPhoto(id, idx) { return this._withdrawPhoto(id, 'customizingPhotos', idx); },

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

  // DELIVERED 상태는 "카마스터 개인수령확인"과 "고객 최종인수승인" 양쪽이 모두 끝나야 CONFIRMED로
  // 전환된다 — 어느 쪽이 먼저든 상관없다. 신차 케어 서비스는 완전히 별개 서비스이므로 여기서는 더
  // 이상 건드리지 않는다 — 시공사가 스스로 "입고 확인"을 눌러야 그쪽 진행이 시작된다.
  confirmDelivery(id) { // 고객 최종인수승인
    const r = this.getReservation(id);
    if (!r || r.stage !== 'DELIVERED' || r.isCustomerApproved) return r;
    this._update(id, { isCustomerApproved: true }, '고객이 최종 인수를 승인했습니다 (고객 확인 완료)');
    return this._maybeConfirm(id);
  },
  // 검수 라디오(이상없음/이슈발견) + 전자서명이 모두 갖춰져야 [인수 확인] CTA가 실제로 눌리는 게 정상
  // 흐름이다(customer.js가 그 검증을 미리 하지만, Store도 한 번 더 가드한다). 검수 결과·메모·사진·
  // 서명을 한 번에 저장한 뒤, 기존 confirmDelivery(고객 최종인수승인) 로직을 그대로 이어 탄다.
  submitCustomerInspection(id, { inspectionResult, inspectionNote, photos, signature }) {
    const r = this.getReservation(id);
    if (!r || r.stage !== 'DELIVERED' || r.isCustomerApproved) return r;
    if (inspectionResult !== 'ok' && inspectionResult !== 'issue') return r;
    const note = (inspectionNote || '').trim();
    if (inspectionResult === 'issue' && !note) return r;
    if (!signature) return r;
    const customerPhotos = (photos || []).map((p, i) => ({ src: p.src, label: p.label || `고객 촬영 사진 ${i + 1}`, uploadedAt: Date.now() }));
    this._update(id, { inspectionResult, inspectionNote: note, customerPhotos, signature },
      `고객 검수 완료 — ${inspectionResult === 'issue' ? '이슈 발견' : '이상없음'}${note ? ` (${note})` : ''}`);
    return this.confirmDelivery(id);
  },
  confirmManagerReceipt(id) { // 카마스터 개인수령확인
    const r = this.getReservation(id);
    if (!r || r.stage !== 'DELIVERED' || r.isManagerConfirmed) return r;
    this._update(id, { isManagerConfirmed: true }, '카마스터가 개인수령확인을 완료했습니다');
    return this._maybeConfirm(id);
  },
  _maybeConfirm(id) {
    const r = this.getReservation(id);
    if (!r || r.stage !== 'DELIVERED' || !r.isManagerConfirmed || !r.isCustomerApproved) return r;
    return this._update(id, { stage: 'CONFIRMED' }, '카마스터 개인수령확인 + 고객 최종인수승인 완료 — 거래 종결 (CONFIRMED)');
  },
  // 관리자 전용 신속처리 — 카마스터 개인수령확인 + 고객 최종인수승인을 한 번에 대리 처리한다.
  forceConfirmDeliveryBoth(id) {
    this.confirmManagerReceipt(id);
    return this.confirmDelivery(id);
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
  if (stage === 'CONFIRMED') return 'done';
  if (stage === '고객요청' || stage === '계약등록') return 'wait';
  if (stage === 'EXCEPTION') return 'warn';
  return 'info';
}
// 신차인도서비스 배송 단계 Enum의 표시용 한글 라벨 — 계약 단계(고객요청/계약등록/계약확정)는 원문 그대로 쓴다.
const STAGE_DISPLAY_LABELS = {
  IN_TRANSIT: '탁송중', CUSTOMIZING: '커스터마이징중', DELIVERED: '탁송완료(확인대기)', CONFIRMED: '인도완료', EXCEPTION: '지연/예외',
};
function stageDisplayLabel(stage) { return STAGE_DISPLAY_LABELS[stage] || stage; }
// 상태 스텝 바(신차배송조회 5~7단계 Enum) 표시용 라벨 — READY/DISPATCHED는 데모에서 즉시 완료 처리되지만
// (requestRelease 참고) 스텝 바에는 "이미 지난 단계"로 여전히 표시되어야 한다.
const DELIVERY_STAGE_LABELS = {
  READY: '출고 준비', DISPATCHED: '기사 배차', IN_TRANSIT: '탁송 진행중', IN_TRANSIT_1: '탁송 진행중 (1차)', IN_TRANSIT_2: '탁송 진행중 (2차)',
  CUSTOMIZING: '커스터마이징', DELIVERED: '탁송 완료', CONFIRMED: '거래 종결',
};
// 예약 하나가 배송 Enum 순서상 몇 번째 단계에 있는지 계산한다. hasCustomizing(destinationType이
// AFFILIATED_SHOP인지) 여부에 따라 IN_TRANSIT이 (제휴 시공소행 1차 / 최종 목적지행 2차) 두 번 등장할
// 수 있어, transitStage로 구분한다.
function deliveryPhaseIndex(r) {
  const hasCustom = hasCustomizing(r);
  const order = hasCustom
    ? ['READY', 'DISPATCHED', 'IN_TRANSIT_1', 'CUSTOMIZING', 'IN_TRANSIT_2', 'DELIVERED', 'CONFIRMED']
    : ['READY', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];
  const stage = r.stage === 'EXCEPTION' ? r.exceptionPrevStage : r.stage;
  let code = stage;
  if (stage === 'IN_TRANSIT' && hasCustom) code = r.transitStage === 'TO_SHOP' ? 'IN_TRANSIT_1' : 'IN_TRANSIT_2';
  return order.indexOf(code);
}
// 출고 전(계약확인~출고요청) 단계 스텝 바 — 배송(탁송) 스텝 바(renderStatusStepperHTML)와는 완전히
// 분리된 별도 컴포넌트다. 앞 단계가 끝나면 그걸로 이 컴포넌트의 역할도 끝이라, IN_TRANSIT 이상으로
// 넘어간 뒤에는(preReleasePhaseIndex가 -1) 표시하지 않는다 — 두 스텝 바를 하나로 이어붙이지 않는다.
const PRE_RELEASE_STEPS = ['계약등록', '카마스터 확인', '출고요청'];
function preReleasePhaseIndex(r) {
  if (r.stage === '고객요청') return 0;
  if (r.stage === '계약등록') return 1;
  if (r.stage === '계약확정') return r.ownerReleaseRequested ? 2 : 1;
  return -1;
}
function renderPreReleaseStepperHTML(r) {
  const idx = preReleasePhaseIndex(r);
  if (idx < 0) return '';
  const steps = PRE_RELEASE_STEPS.map((label, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'cur' : '');
    const fillPct = i < idx ? 100 : 0;
    return `<div class="dstep ${cls}"><div class="dstep-line"><div class="dstep-line-fill" style="width:${fillPct}%"></div></div><div class="dstep-dot">${i + 1}</div><div class="dstep-label">${label}</div></div>`;
  }).join('');
  return `<div class="dstepper">${steps}</div>`;
}
// 신차배송조회 상태 스텝 바 — 계약 단계(출고 요청 전)에는 표시하지 않고, IN_TRANSIT 이상부터 보여준다.
function renderStatusStepperHTML(r) {
  const idx = deliveryPhaseIndex(r);
  if (idx < 0) return '';
  const hasCustom = hasCustomizing(r);
  const order = hasCustom
    ? ['READY', 'DISPATCHED', 'IN_TRANSIT_1', 'CUSTOMIZING', 'IN_TRANSIT_2', 'DELIVERED', 'CONFIRMED']
    : ['READY', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];
  const steps = order.map((code, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'cur' : '');
    const fillPct = i < idx ? 100 : 0;
    return `<div class="dstep ${cls}"><div class="dstep-line"><div class="dstep-line-fill" style="width:${fillPct}%"></div></div><div class="dstep-dot">${i + 1}</div><div class="dstep-label">${DELIVERY_STAGE_LABELS[code]}</div></div>`;
  }).join('');
  // 구체적인 지연 사유 문구는 여기서 노출하지 않는다 — 카마스터 화면은 내부 전용 트리거 사유를,
  // 고객 화면은 게시된 사유(있을 때만)를 각자의 문맥에서 따로 보여준다(카마스터.js/customer.js 참고).
  // 이 스텝 바는 두 화면이 공유하므로 여기서는 "지연 중"이라는 사실만 중립적으로 표시한다.
  const exceptionNote = r.stage === 'EXCEPTION'
    ? `<div class="badge warn" style="display:block;margin-top:6px;">⚠ 배송 지연/예외 상태 진행 중</div>` : '';
  return `<div class="dstepper">${steps}</div>${exceptionNote}`;
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
// 실제 사진 파일을 쓸 수 없는 오프라인 데모라(외부 리소스 로드 불가), 라벨 문맥에 맞는 벡터 아이콘을
// 직접 그려 넣어 "이게 무슨 사진인지" 최소한의 실감이 나도록 한다 — 사업자등록증은 문서 아이콘, 그 외
// (현장사진/인수완료사진/검수사진 등 차량·작업 관련)는 차량 실루엣 아이콘을 쓴다. 라벨에 "완료"나
// "검수"가 들어있으면 체크마크 배지를 얹어 "작업 중"과 "다 끝난 것"을 시각적으로 구분한다.
function generateSamplePhoto(index, label) {
  const [bg, fg] = SAMPLE_PALETTES[index % SAMPLE_PALETTES.length];
  const isDoc = label.includes('사업자등록증');
  const isDone = /완료|검수/.test(label);
  const icon = isDoc
    ? `<g transform="translate(130,28)" fill="none" stroke="${fg}" stroke-width="3" opacity="0.55">
        <rect x="0" y="0" width="60" height="80" rx="4"/>
        <line x1="12" y1="18" x2="48" y2="18"/>
        <line x1="12" y1="30" x2="48" y2="30"/>
        <line x1="12" y1="42" x2="36" y2="42"/>
        <circle cx="42" cy="60" r="12"/>
        <path d="M37 60 l4 4 l7 -8" stroke-width="2.5"/>
      </g>`
    : `<g transform="translate(95,38)" fill="${fg}" opacity="0.55">
        <path d="M10 42 Q10 26 28 24 L48 24 Q62 24 72 40 L122 40 Q130 40 130 48 L130 56 Q130 60 126 60 L10 60 Q4 60 4 54 L4 48 Q4 42 10 42 Z"/>
        <circle cx="34" cy="60" r="11" fill="${bg}" stroke="${fg}" stroke-width="4"/>
        <circle cx="104" cy="60" r="11" fill="${bg}" stroke="${fg}" stroke-width="4"/>
      </g>${isDone ? `<g transform="translate(216,30)" stroke="${fg}" stroke-width="4" fill="none" opacity="0.8"><circle cx="18" cy="18" r="17"/><path d="M9 18 l6 7 l13 -15"/></g>` : ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220">
    <rect width="320" height="220" fill="${bg}"/>
    ${icon}
    <text x="160" y="180" font-family="sans-serif" font-size="14" fill="${fg}" text-anchor="middle" font-weight="bold">${label}</text>
    <text x="160" y="200" font-family="sans-serif" font-size="10" fill="${fg}" text-anchor="middle" opacity="0.7">샘플 이미지 (데모)</text>
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
window.stageDisplayLabel = stageDisplayLabel;
window.renderStatusStepperHTML = renderStatusStepperHTML;
window.DELAY_REASON_OPTIONS = DELAY_REASON_OPTIONS;
window.delayReasonLabel = delayReasonLabel;
window.DESTINATION_TYPE_OPTIONS = DESTINATION_TYPE_OPTIONS;
window.destinationTypeLabel = destinationTypeLabel;
window.hasCustomizing = hasCustomizing;
window.brandsHandledFor = brandsHandledFor;
window.brandAffiliationFor = brandAffiliationFor;
window.karmasterDisplayName = karmasterDisplayName;
window.reservationInAdminScope = reservationInAdminScope;
window.careOrderInAdminScope = careOrderInAdminScope;
window.shopInAdminScope = shopInAdminScope;
window.amBadgeClass = amBadgeClass;
window.transitProgress = transitProgress;
window.renderDeliveryStepperHTML = renderDeliveryStepperHTML;
window.renderShopTimelineHTML = renderShopTimelineHTML;
window.renderHistoryLogHTML = renderHistoryLogHTML;
window.generateSamplePhoto = generateSamplePhoto;
window.TRANSIT_DURATION_MS = TRANSIT_DURATION_MS;
window.POINT_REWARD_DELIVERY = POINT_REWARD_DELIVERY;
window.POINT_REWARD_AFTERMARKET = POINT_REWARD_AFTERMARKET;
