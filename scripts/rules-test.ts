// 규칙 시연 테스트: "규칙을 어기는 요청이 정말 거절되는지"를 하나씩 확인해요.
// 사용:  (서버가 켜져 있어야 해요)  npm run test:rules
// 시작 전에 hw2 의 테이블을 지우고 가상 데이터를 다시 채워요. 끝나면 한 번 더 깨끗하게 채워 둬요.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:4000';
const kst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const today = kst.format(new Date()).slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const at = (day: number, hm: string) => `${addDays(today, day)}T${hm}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '  통과' : '  실패'}  ${name}${ok ? '' : `  ← ${detail}`}`);
}
function section(t: string) { console.log(`\n■ ${t}`); }

async function call(method: string, path: string, token?: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 비어 있는 응답 */ }
  return { status: res.status, body: json };
}
const msg = (r: { body: any }) => String(r.body?.message ?? '');
async function login(email: string, password: string) {
  const r = await call('POST', '/auth/login', undefined, { email, password });
  if (r.status !== 200 && r.status !== 201) throw new Error(`로그인 실패: ${email} ${r.status} ${msg(r)}`);
  return { token: r.body.token as string, user: r.body.user };
}

function reseed() {
  execSync('npx tsx scripts/db-init.ts --reset', { stdio: 'pipe' });
  execSync('npx tsx scripts/db-seed.ts', { stdio: 'pipe' });
}

async function main() {
  console.log('hw2 를 깨끗하게 다시 채우는 중...');
  reseed();

  const nuri = await login('customer01@nuri.test', 'Customer#2026');
  const sales = await login('sales@nuri.test', 'Customer#2026');
  const dev = await login('dev@nuri.test', 'Customer#2026');
  const mk2 = await login('mk@nuri.test', 'Customer#2026');
  const staff1 = await login('staff1@nuri.test', 'Staff#2026');
  const staff2 = await login('staff2@nuri.test', 'Staff#2026');
  const admin = await login('admin@nuri.test', 'Admin#2026');

  const vehicles = (await call('GET', '/vehicles', nuri.token)).body as any[];
  const V = (model: string) => vehicles.find((v) => v.model === model).id as number;
  const sonata = V('쏘나타'), carnival = V('카니발'), avante = V('아반떼');
  const emps = (await call('GET', '/employees', staff1.token)).body.items as any[];
  const E = (name: string) => emps.find((e) => e.name === name).id as number;

  // ---------- 계정 ----------
  section('가입·로그인·계정');
  let r = await call('POST', '/auth/login', undefined, { email: 'customer01@nuri.test', password: 'wrong' });
  check('틀린 비밀번호는 어느 쪽이 틀렸는지 알려 주지 않고 거절', r.status === 401 && msg(r).includes('이메일이나 비밀번호'), msg(r));
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E010', name: '다른사람', email: 'x1@nuri.test', password: 'Passw0rd!' });
  check('가입: 사번과 이름이 명부와 다르면 거절 [계-6]', r.status === 400 && msg(r).includes('명부'), msg(r));
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E001', name: '김관리', email: 'x2@nuri.test', password: 'Passw0rd!' });
  check('가입: 총무팀 직원은 직접 가입할 수 없음', r.status === 400 && msg(r).includes('총무팀'), msg(r));
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E010', name: '한재무', email: 'CUSTOMER01@nuri.test', password: 'Passw0rd!' });
  check('가입: 이메일 중복 불가(대소문자 무시)', r.status === 400 && msg(r).includes('이미 가입된 이메일'), msg(r));
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E010', name: '한재무', email: 'fin@nuri.test', password: 'short' });
  check('가입: 비밀번호 8자 미만 거절', r.status === 400, msg(r));
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E008', name: '최마케', email: 'mk1@nuri.test', password: 'Passw0rd!' });
  check('가입 성공(명부의 본인과 연결)', r.status === 201 || r.status === 200, msg(r));
  const mk1 = r.body?.token as string;
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E008', name: '최마케', email: 'mk1b@nuri.test', password: 'Passw0rd!' });
  check('가입: 이미 가입된 사번은 다시 가입할 수 없음', r.status === 400 && msg(r).includes('이미 가입된 직원'), msg(r));
  r = await call('GET', '/reservations');
  check('로그인 없이는 아무것도 볼 수 없음', r.status === 401, String(r.status));

  // ---------- 예약 규칙 ----------
  section('예약 규칙 [R-1]~[R-11]');
  const base = (over: any = {}) => ({ vehicleId: sonata, startAt: at(5, '09:00'), endAt: at(5, '18:00'), destination: '테스트 출장', passengerCount: 1, ...over });
  r = await call('POST', '/reservations', nuri.token, base({ startAt: at(0, '15:00'), endAt: at(0, '18:00') }));
  check('[R-4] 당일 예약 불가(하루 전까지)', r.status === 400 && msg(r).includes('하루 전'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ startAt: at(5, '18:00'), endAt: at(5, '09:00') }));
  check('[R-2] 끝 시각이 시작보다 늦어야 함', r.status === 400 && msg(r).includes('늦어야'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ endAt: at(9, '09:00') }));
  check('[R-3] 72시간(3일) 초과 불가', r.status === 400 && msg(r).includes('72시간'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ startAt: at(14, '09:00'), endAt: at(17, '09:00') }));
  check('[R-3] 정확히 72시간은 허용 (규칙 경계)', r.status === 400 ? false : true, `${r.status} ${msg(r)}`);
  if (r.body?.id) await call('POST', `/reservations/${r.body.id}/cancel`, nuri.token);
  r = await call('POST', '/reservations', nuri.token, base({ passengerCount: 6, companions: [{ employeeId: E('박영업') }, { employeeId: E('이개발') }, { employeeId: E('한재무') }, { employeeId: E('최마케') }, { employeeId: E('윤개발') }] }));
  check('[R-5] 7명 탈 일 없이 5인승에 6명은 불가', r.status === 400 && msg(r).includes('5명까지'), msg(r));
  r = await call('POST', '/reservations', mk1, { vehicleId: sonata, startAt: at(5, '09:00'), endAt: at(5, '18:00'), destination: 'x', passengerCount: 1 });
  check('[R-7] 면허 승인 전에는 예약 불가', r.status === 400 && msg(r).includes('승인'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ startAt: at(19, '09:00'), endAt: at(19, '18:00') }));
  check('[R-8] 예약 끝 날짜가 면허 만료일(18일 뒤)보다 뒤면 불가', r.status === 400 && msg(r).includes('만료'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ startAt: at(18, '09:00'), endAt: at(18, '18:00'), vehicleId: carnival }));
  check('[R-8] 끝 날짜가 만료일과 같은 날이면 허용', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  if (r.body?.id) await call('POST', `/reservations/${r.body.id}/cancel`, nuri.token);
  r = await call('POST', '/reservations', nuri.token, base({ passengerCount: 3, companions: [{ employeeId: E('박영업') }] }));
  check('[R-9] 탑승 3명인데 동승자 1명이면 불가', r.status === 400 && msg(r).includes('2명'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ passengerCount: 1, companions: [{ employeeId: E('박영업') }] }));
  check('[R-9] 혼자 타는데 동승자를 고르면 불가', r.status === 400, msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ passengerCount: 2, companions: [{ employeeId: E('김누리') }] }));
  check('[R-9] 운전자 본인을 동승자로 선택 불가', r.status === 400 && msg(r).includes('본인'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ passengerCount: 3, companions: [{ employeeId: E('박영업') }, { employeeId: E('박영업') }] }));
  check('[R-9] 같은 동승자를 두 번 선택 불가', r.status === 400 && msg(r).includes('두 번'), msg(r));
  r = await call('POST', '/reservations', nuri.token, base({ vehicleId: avante, startAt: at(11, '09:00'), endAt: at(11, '18:00') }));
  check('[R-6] 점검 기간에는 예약 불가', r.status === 400 && msg(r).includes('점검'), msg(r));
  r = await call('POST', '/reservations', dev.token, base({ startAt: at(1, '15:00'), endAt: at(1, '16:00') }));
  check('[R-1] 같은 차 시간 겹침 불가', r.status === 409 && msg(r).includes('이미 예약'), `${r.status} ${msg(r)}`);
  r = await call('POST', '/reservations', dev.token, base({ startAt: at(1, '17:15'), endAt: at(1, '18:15') }));
  check('[R-1] 앞 예약이 끝난 뒤 30분 안에 시작하는 예약도 불가', r.status === 409, `${r.status} ${msg(r)}`);
  r = await call('POST', '/reservations', dev.token, base({ startAt: at(1, '17:30'), endAt: at(1, '18:30') }));
  check('[R-1] 30분이 지난 17:30 시작은 허용 (경계)', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  const devRes = r.body?.id;
  r = await call('POST', '/reservations', nuri.token, base({ vehicleId: carnival, startAt: at(1, '14:00'), endAt: at(1, '15:00') }));
  check('[R-11] 같은 운전자는 시간이 겹치는 다른 차도 예약 불가', r.status === 409 && msg(r).includes('다른 차'), `${r.status} ${msg(r)}`);
  r = await call('POST', '/reservations', nuri.token, base({ vehicleId: carnival, startAt: at(15, '09:00'), endAt: at(15, '18:00'), passengerCount: 3, companions: [{ employeeId: E('박영업') }, { guestName: '이거래', guestOrg: '(주)가람' }] }));
  check('예약 신청 성공 (직원 + 외부 손님 동승)', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  const nuriRes = r.body?.id;
  const [a, b] = await Promise.all([
    call('POST', '/reservations', dev.token, { vehicleId: carnival, startAt: at(7, '10:00'), endAt: at(7, '12:00'), destination: '동시 신청', passengerCount: 1 }),
    call('POST', '/reservations', sales.token, { vehicleId: carnival, startAt: at(7, '10:00'), endAt: at(7, '12:00'), destination: '동시 신청', passengerCount: 1 }),
  ]);
  const okCount = [a, b].filter((x) => x.status === 201 || x.status === 200).length;
  check('동시에 같은 차를 신청해도 한 명만 성공', okCount === 1 && [a, b].some((x) => x.status === 409), `${a.status}/${b.status}`);
  const concurrentWinner = (a.status === 201 || a.status === 200) ? { who: dev, id: a.body.id } : { who: sales, id: b.body.id };

  // ---------- 권한 ----------
  section('권한: 내 것만 보기 · 총무팀 전용');
  r = await call('GET', '/reservations?size=100', nuri.token);
  check('고객은 내 예약만 목록에 보임', r.body.items.length > 0 && r.body.items.every((x: any) => x.driverName === '김누리'), `${r.body.items.length}`);
  const salesRes = (await call('GET', '/reservations?size=100', sales.token)).body.items[0].id;
  r = await call('GET', `/reservations/${salesRes}`, nuri.token);
  check('고객이 남의 예약 번호로 열면 거절', r.status === 403, String(r.status));
  r = await call('GET', '/stats/home', nuri.token);
  check('고객이 어드민 통계에 들어가면 거절', r.status === 403 && msg(r).includes('쓸 수 없는'), `${r.status} ${msg(r)}`);
  r = await call('GET', '/reservations?size=100', staff1.token);
  check('총무팀은 전체 예약을 봄', r.body.total > r.body.items.filter((x: any) => x.driverName === '김누리').length, `${r.body.total}`);
  r = await call('POST', `/reservations/${nuriRes}/cancel`, sales.token);
  check('[취-1] 남의 예약은 고객이 취소할 수 없음', r.status === 403, String(r.status));
  r = await call('POST', `/reservations/${nuriRes}/cancel`, staff1.token);
  check('[취-2] 총무팀은 대신 취소할 수 있음', r.status === 200 || r.status === 201, `${r.status} ${msg(r)}`);
  r = await call('POST', `/reservations/${nuriRes}/cancel`, nuri.token);
  check('이미 취소된 예약은 다시 취소할 수 없음', r.status === 400, msg(r));
  r = await call('POST', `/reservations/${concurrentWinner.id}/cancel`, concurrentWinner.who.token);
  check('[취-1] 본인은 출발 전에 취소할 수 있음', r.status === 200 || r.status === 201, `${r.status} ${msg(r)}`);
  if (devRes) await call('POST', `/reservations/${devRes}/cancel`, dev.token);

  // ---------- 운행 ----------
  section('운행: 출발 · 주유 · 도착 · 반납 확인');
  const myList = (await call('GET', '/reservations?size=100&status=예약됨', nuri.token)).body.items;
  r = await call('POST', `/reservations/${myList[0].id}/depart`, nuri.token);
  check('출발은 예약한 날부터만 할 수 있음', r.status === 400 && msg(r).includes('예약한 날'), `${r.status} ${msg(r)}`);
  const running = (await call('GET', '/reservations?size=100&status=운행 중', sales.token)).body.items.find((x: any) => x.destination === '부산 출장');
  r = await call('POST', `/reservations/${running.id}/cancel`, sales.token);
  check('[C-3] 이미 출발한 예약은 취소할 수 없음', r.status === 400 && msg(r).includes('출발'), msg(r));
  r = await call('POST', `/reservations/${running.id}/fuel`, sales.token, { amount: 0, liters: 10 });
  check('[유-2] 주유 금액 0원은 거절', r.status === 400, msg(r));
  r = await call('POST', `/reservations/${running.id}/fuel`, sales.token, { amount: 50000, liters: 27.5 });
  check('[유-1] 운행 중 주유 기록을 여러 번 남길 수 있음', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  r = await call('POST', `/reservations/${running.id}/fuel`, nuri.token, { amount: 1000, liters: 1 });
  check('남의 운행에는 주유 기록을 남길 수 없음', r.status === 403, String(r.status));
  const startOdo = (await call('GET', `/reservations/${running.id}`, sales.token)).body.trip.startOdometer;
  r = await call('POST', `/reservations/${running.id}/return`, sales.token, { endOdometer: startOdo });
  check('[운-1] 도착 거리가 출발과 같거나 작으면 거절', r.status === 400 && msg(r).includes('커야'), msg(r));
  r = await call('POST', `/reservations/${running.id}/return`, sales.token, { endOdometer: startOdo + 600 });
  check('[운-3] 500km 넘으면 경고', r.status === 400 && r.body?.code === 'DISTANCE_WARNING', `${r.status} ${msg(r)}`);
  r = await call('POST', `/reservations/${running.id}/return`, sales.token, { endOdometer: startOdo + 600, acknowledge: true });
  check('경고를 확인하고 다시 보내면 [확인 대기]로 바뀜', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  r = await call('POST', `/reservations/${running.id}/fuel`, sales.token, { amount: 10000, liters: 5 });
  check('확인 대기 중에도 주유 기록은 남길 수 있음', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  r = await call('POST', `/reservations/${running.id}/confirm`, sales.token, {});
  check('고객은 반납 확인을 할 수 없음', r.status === 403, String(r.status));
  r = await call('POST', `/reservations/${running.id}/confirm`, staff1.token, { smokingViolation: true });
  check('[운-5] 총무팀이 반납 확인 → 반납, 확인자·시각 기록', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  const done = (await call('GET', `/reservations/${running.id}`, staff1.token)).body;
  check('반납 확인 후 상태 = 반납, 확인자 기록, 흡연 위반 표시', done.status === '반납' && done.trip.confirmedBy && done.trip.smokingViolation === true, JSON.stringify(done.trip));
  r = await call('POST', `/reservations/${running.id}/fuel`, sales.token, { amount: 10000, liters: 5 });
  check('[운-7] 반납 후에는 직원이 주유 기록을 추가할 수 없음', r.status === 400, `${r.status} ${msg(r)}`);
  const own = (await call('GET', '/reservations?size=100&status=확인 대기', staff1.token)).body.items.find((x: any) => x.driverName === '이총무');
  r = await call('POST', `/reservations/${own.id}/confirm`, staff1.token, {});
  check('[운-5] 총무팀도 자기가 운행한 예약은 자기가 확인할 수 없음', r.status === 403 && msg(r).includes('자기가 운행'), `${r.status} ${msg(r)}`);
  r = await call('POST', `/reservations/${own.id}/confirm`, staff2.token, {});
  check('다른 총무팀 직원은 확인할 수 있음', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  r = await call('GET', '/reservations/overdue', staff1.token);
  check('[운-8] 반납 예정이 지난 미반납 예약이 목록에 나옴', r.status === 200 && r.body.some((x: any) => x.destination === '성남 고객사' && x.overdueMinutes > 30), `${r.status}`);
  r = await call('PATCH', `/reservations/${running.id}/start-odometer`, nuri.token, { startOdometer: 1 });
  check('출발 거리 수정은 고객 불가', r.status === 403, String(r.status));

  // ---------- 점검 ----------
  section('점검 일정 [점-1]');
  r = await call('POST', '/maintenance', staff1.token, { vehicleId: sonata, startDate: addDays(today, 1), endDate: addDays(today, 1), reason: '테스트' });
  check('이미 예약이 있는 기간에는 점검을 등록할 수 없음', r.status === 409 && msg(r).includes('예약'), `${r.status} ${msg(r)}`);
  r = await call('POST', '/maintenance', staff1.token, { vehicleId: avante, startDate: addDays(today, 11), endDate: addDays(today, 13), reason: '겹침 테스트' });
  check('같은 차 점검 기간끼리 겹치면 불가', r.status === 409, `${r.status} ${msg(r)}`);
  r = await call('POST', '/maintenance', staff1.token, { vehicleId: sonata, startDate: addDays(today, 40), endDate: addDays(today, 41), reason: '타이어 교체' });
  check('예약이 없는 기간에는 점검 등록 성공', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  r = await call('POST', '/maintenance', nuri.token, { vehicleId: sonata, startDate: addDays(today, 50), endDate: addDays(today, 51), reason: 'x' });
  check('고객은 점검을 등록할 수 없음', r.status === 403, String(r.status));

  // ---------- 면허 ----------
  section('면허 승인 [L-5] [L-6]');
  const mk1Emp = E('최마케');
  r = await call('POST', `/employees/${E('이총무')}/license/approve`, staff1.token);
  check('[L-6] 자기 면허는 자기가 승인할 수 없음', r.status === 403, `${r.status} ${msg(r)}`);
  r = await call('POST', `/employees/${mk1Emp}/license/approve`, staff1.token);
  check('총무팀이 면허를 승인', r.status === 200 || r.status === 201, `${r.status} ${msg(r)}`);
  r = await call('PATCH', '/employees/me/license', mk1, { expiry: addDays(today, 365) });
  check('[면-4] 만료일을 바꾸면 다시 승인 대기', r.status === 200 && r.body.licenseStatus === '승인 대기', `${r.status}`);
  r = await call('GET', '/employees/license-expiring', staff1.token);
  check('면허 만료 30일 이내 직원 목록 + 예약 후 만료된 예약 표시', r.body.expiring.length >= 2 && r.body.expiredReservations.some((x: any) => x.driverName === '정마케'), JSON.stringify(r.body).slice(0, 120));

  // ---------- 개인 차량 정산 ----------
  section('개인 차량 정산 [개-1]~[개-10]');
  const claim = (over: any = {}) => ({ travelDate: addDays(today, -5), destination: '테스트 출장', distanceKm: 100, ...over });
  r = await call('POST', '/claims', nuri.token, claim({ travelDate: addDays(today, -4) }));
  check('[개-6] 같은 날 정산은 한 건만', r.status === 409, `${r.status} ${msg(r)}`);
  r = await call('POST', '/claims', nuri.token, claim({ travelDate: addDays(today, 1) }));
  check('[개-5] 미래 날짜는 신청 불가', r.status === 400, msg(r));
  r = await call('POST', '/claims', nuri.token, claim({ travelDate: addDays(today, -31) }));
  check('[개-5] 30일이 지난 건은 신청 불가', r.status === 400 && msg(r).includes('30일'), msg(r));
  r = await call('POST', '/claims', nuri.token, claim({ distanceKm: 0 }));
  check('[개-4] 거리 0은 불가', r.status === 400, msg(r));
  r = await call('POST', '/claims', nuri.token, claim({ distanceKm: 1200 }));
  check('[개-7] 1,000km 넘으면 경고', r.status === 400 && r.body?.code === 'DISTANCE_WARNING', `${r.status} ${msg(r)}`);
  r = await call('POST', '/claims', nuri.token, claim({ distanceKm: 120 }));
  check('[개-2] 정산 신청 성공, 금액 = 거리 × 200원 (120km → 24,000원)', (r.status === 201 || r.status === 200) && r.body.amount === 24000, `${r.status} ${JSON.stringify(r.body)}`);
  const newClaim = r.body?.id;
  r = await call('POST', `/claims/${newClaim}/approve`, nuri.token);
  check('고객은 정산을 승인할 수 없음', r.status === 403, String(r.status));
  const claims = (await call('GET', '/claims?size=100', staff1.token)).body.items as any[];
  const staff1Claim = claims.find((c) => c.employeeName === '이총무');
  r = await call('POST', `/claims/${staff1Claim.id}/approve`, staff1.token);
  check('[개-8] 자기 정산은 자기가 승인할 수 없음', r.status === 403, `${r.status} ${msg(r)}`);
  r = await call('POST', `/claims/${staff1Claim.id}/approve`, staff2.token);
  check('다른 총무팀 직원은 승인할 수 있음', r.status === 200 || r.status === 201, `${r.status} ${msg(r)}`);
  r = await call('POST', `/claims/${newClaim}/reject`, staff1.token, {});
  check('[개-8] 반려는 사유가 필수', r.status === 400, msg(r));
  r = await call('POST', `/claims/${newClaim}/reject`, staff1.token, { reason: '거리를 다시 확인해 주세요' });
  check('사유를 적으면 반려됨', r.status === 200 || r.status === 201, `${r.status} ${msg(r)}`);
  r = await call('POST', `/claims/${newClaim}/cancel`, nuri.token);
  check('[개-9] 처리된 정산은 직원이 취소할 수 없음', r.status === 400, msg(r));
  r = await call('GET', '/claims/monthly', staff1.token);
  check('이번 달 직원별·부서별 승인 금액 집계', r.status === 200 && Array.isArray(r.body.byEmployee), `${r.status}`);

  // ---------- 통계 ----------
  section('통계 [집-1]~[집-5]');
  r = await call('GET', '/stats/vehicles-monthly', staff1.token);
  check('차량별 이번 달 운행 거리·주유비·1km당 주유비', r.status === 200 && r.body.items.length === 3 && 'costPerKm' in r.body.items[0], `${r.status}`);
  r = await call('GET', '/stats/departments-monthly', staff1.token);
  check('부서별 이번 달 이용 횟수·운행 거리', r.status === 200 && r.body.items.length === 5, `${r.status}`);
  r = await call('GET', `/reservations/availability?date=${addDays(today, 1)}`, staff1.token);
  check('날짜별 차량 예약 현황표', r.status === 200 && r.body.vehicles.length === 3, `${r.status}`);

  // ---------- 계정 관리 ----------
  section('총무팀 계정 관리 [계-2]~[계-4]');
  r = await call('GET', '/accounts', staff1.token);
  check('일반 직원은 계정 관리에 들어갈 수 없음', r.status === 403 && msg(r).includes('관리자'), `${r.status} ${msg(r)}`);
  r = await call('GET', '/accounts', admin.token);
  check('관리자는 직원 계정 목록을 봄', r.status === 200 && r.body.length === 3, `${r.status}`);
  const s2 = (r.body as any[]).find((x) => x.email === 'staff2@nuri.test');
  r = await call('POST', `/accounts/${s2.id}/reset-password`, admin.token);
  check('비밀번호 리셋 → 임시 비밀번호 발급', r.status === 201 || r.status === 200, `${r.status}`);
  const temp = r.body.tempPassword as string;
  const t = await login('staff2@nuri.test', temp);
  check('임시 비밀번호로 로그인하면 변경이 필요하다고 표시', t.user.mustChangePassword === true);
  r = await call('GET', '/reservations', t.token);
  check('변경 전에는 다른 일을 할 수 없음', r.status === 403 && r.body?.code === 'MUST_CHANGE_PASSWORD', `${r.status}`);
  r = await call('POST', '/auth/change-password', t.token, { currentPassword: temp, newPassword: 'NewPass#2026' });
  check('비밀번호를 바꾸면 다시 쓸 수 있음', r.status === 201 || r.status === 200, `${r.status} ${msg(r)}`);
  r = await call('PATCH', `/accounts/${s2.id}`, admin.token, { status: '정지' });
  check('계정 사용 정지', r.status === 200, `${r.status}`);
  r = await call('POST', '/auth/login', undefined, { email: 'staff2@nuri.test', password: 'NewPass#2026' });
  check('정지된 계정은 로그인할 수 없음', r.status === 401 && msg(r).includes('정지'), `${r.status} ${msg(r)}`);
  r = await call('GET', '/auth/me', t.token);
  check('이미 받은 출입증도 정지되면 바로 막힘', r.status === 401, `${r.status}`);
  const me = (await call('GET', '/auth/me', admin.token)).body;
  r = await call('PATCH', `/accounts/${me.id}`, admin.token, { status: '정지' });
  check('관리자가 자기 계정을 정지할 수는 없음', r.status === 403, `${r.status}`);

  // ---------- 챗봇 ----------
  section('규정 챗봇');
  r = await call('GET', '/chat/status', nuri.token);
  check('챗봇 연결 상태 조회', r.status === 200 && typeof r.body.connected === 'boolean');
  if (!r.body.connected) {
    r = await call('POST', '/chat', nuri.token, { message: '3일 넘게 빌릴 수 있어요?' });
    check('Dify 키가 없으면 "아직 연결되지 않았어요"로 안내', r.status === 503 && msg(r).includes('연결'), `${r.status} ${msg(r)}`);
  }

  // ---------- DB 가 직접 막는 것 ----------
  section('가상 데이터 다시 채우기 (관리자 전용)');
  r = await call('POST', '/admin/reset-demo', staff1.token);
  check('일반 직원은 가상 데이터 다시 채우기를 할 수 없음', r.status === 403, `${r.status} ${msg(r)}`);
  r = await call('POST', '/admin/reset-demo', nuri.token);
  check('고객도 할 수 없음', r.status === 403, String(r.status));
  let demoN = 0;
  let demoC = 0;
  const mkBefore = (await call('GET', '/employees?size=100', staff1.token)).body.items.find((e: any) => e.name === '최마케');
  r = await call('POST', '/admin/reset-demo', admin.token);
  check('관리자는 다시 채울 수 있음', (r.status === 201 || r.status === 200) && (demoN = r.body.reservations) >= 25 && (demoC = r.body.claims) >= 10, `${r.status} ${msg(r)}`);
  r = await call('GET', '/reservations?size=100', admin.token);
  check('예약이 처음 가상 데이터로 돌아감 (테스트로 만든 예약은 사라짐)', r.body.total === demoN && !r.body.items.some((x: any) => x.destination === '테스트 출장'), `${r.body.total}`);
  check('예약 번호가 1번부터 다시 시작', r.body.items.some((x: any) => x.id === 1), JSON.stringify(r.body.items.map((x: any) => x.id)));
  r = await call('GET', '/claims?size=100', admin.token);
  check('개인 차량 정산도 처음으로 돌아감', r.body.total === demoC, `${r.body.total}`);
  r = await call('GET', '/maintenance', admin.token);
  check('점검 일정도 처음(3건)으로 돌아감', r.status === 200 && r.body.length === 3, `${r.status}`);
  r = await call('GET', '/auth/me', nuri.token);
  check('로그인은 그대로 유지됨 (계정은 지우지 않음)', r.status === 200 && r.body.email === 'customer01@nuri.test', `${r.status}`);
  const mkAfter = (await call('GET', '/employees?size=100', staff1.token)).body.items.find((e: any) => e.name === '최마케');
  check('직원 명부·가입 정보도 그대로 (최마케 가입 상태 유지)', mkAfter.hasAccount === mkBefore.hasAccount && mkAfter.licenseStatus === mkBefore.licenseStatus, JSON.stringify([mkBefore, mkAfter]));
  r = await call('GET', '/reservations/overdue', staff1.token);
  check('다시 채운 뒤에도 미반납 예약 1건이 있음', r.status === 200 && r.body.length === 1, `${r.status} ${r.body?.length}`);
  r = await call('POST', '/admin/reset-demo', admin.token);
  check('여러 번 눌러도 같은 결과', (r.status === 201 || r.status === 200) && (await call('GET', '/reservations?size=100', admin.token)).body.total === demoN, `${r.status}`);

  section('DB 가 직접 막는 것 (백엔드를 거치지 않아도)');
  const url = process.env.DATABASE_URL!;
  const db = new pg.Client({ connectionString: url, ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : { rejectUnauthorized: false } });
  await db.connect();
  await db.query(`SET search_path TO hw2, public`);
  const tryDb = async (name: string, sql: string, codes: string[]) => {
    try {
      await db.query('BEGIN');
      await db.query(sql);
      await db.query('ROLLBACK');
      check(name, false, '거절되지 않았어요');
    } catch (e: any) {
      await db.query('ROLLBACK').catch(() => undefined);
      check(name, codes.includes(e.code), `${e.code} ${e.message}`);
    }
  };
  const anyRes = await db.query(`SELECT vehicle_id, driver_id, department_id, created_by FROM reservations WHERE status = '반납' LIMIT 1`);
  const x = anyRes.rows[0];
  const ins = (s: string, e: string) =>
    `INSERT INTO reservations (vehicle_id, driver_id, department_id, start_at, end_at, destination, passenger_count, created_by) VALUES (${x.vehicle_id}, ${x.driver_id}, ${x.department_id}, '${s}', '${e}', 'x', 1, ${x.created_by})`;
  const firstRes = await db.query(`SELECT start_at, end_at FROM reservations WHERE vehicle_id = ${x.vehicle_id} AND status <> '취소' ORDER BY start_at LIMIT 1`);
  const fs = String(firstRes.rows[0].start_at.toISOString?.() ?? firstRes.rows[0].start_at);
  await tryDb('끝 시각 > 시작 시각 (DB)', ins('2030-01-02 10:00', '2030-01-02 09:00'), ['23514']);
  await tryDb('최대 72시간 (DB)', ins('2030-01-02 10:00', '2030-01-06 10:00'), ['23514']);
  await tryDb('같은 차 시간 겹침 금지 (DB)', `INSERT INTO reservations (vehicle_id, driver_id, department_id, start_at, end_at, destination, passenger_count, created_by)
     SELECT vehicle_id, ${x.driver_id}, ${x.department_id}, start_at + interval '1 hour', end_at - interval '1 hour', 'x', 1, ${x.created_by}
       FROM reservations WHERE status <> '취소' AND end_at - start_at > interval '3 hours' AND vehicle_id <> ${x.vehicle_id} LIMIT 1`, ['23P01']);
  await tryDb('도착 거리 > 출발 거리 (DB)', `UPDATE trips SET end_odometer = start_odometer WHERE end_odometer IS NOT NULL`, ['23514']);
  await tryDb('주유 금액 0원 금지 (DB)', `INSERT INTO fuel_records (trip_id, fueled_on, amount, liters) SELECT id, current_date, 0, 5 FROM trips LIMIT 1`, ['23514']);
  await tryDb('동승자는 직원 또는 손님 중 하나 (DB)', `INSERT INTO reservation_companions (reservation_id) SELECT id FROM reservations LIMIT 1`, ['23514']);
  await tryDb('차량번호 중복 금지 (DB)', `INSERT INTO vehicles (model, plate_no, seat_count, initial_odometer) VALUES ('테스트', '12가 3456', 5, 0)`, ['23505']);
  await tryDb('이메일 중복 금지(대소문자 무시) (DB)', `INSERT INTO users (email, password_hash, role) VALUES ('ADMIN@NURI.TEST', 'x', '고객')`, ['23505']);
  await db.end();
  void fs;

  console.log(`\n결과: 통과 ${pass}개, 실패 ${fail}개`);
  console.log('가상 데이터를 깨끗하게 다시 채우는 중...');
  reseed();
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('테스트 중단:', e.message);
  process.exitCode = 1;
});
