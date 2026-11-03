// 보안·안전장치 추가 테스트 (서버가 켜져 있어야 해요). 사용:  npm run test:extra
// 가입 우회 시도처럼 데이터를 만드는 확인이 있어서, 끝나면 가상 데이터를 처음 상태로 되돌려요.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:4000';
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  통과' : '  실패'}  ${name}${ok ? '' : `  ← ${detail}`}`);
};
const section = (t: string) => console.log(`\n■ ${t}`);

async function call(method: string, path: string, token?: string, body?: any, raw?: string) {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const ms = performance.now() - t0;
  let json: any = null;
  try { json = await res.json(); } catch { /* 빈 응답 */ }
  return { status: res.status, body: json, ms };
}
const login = async (email: string, pw: string) => (await call('POST', '/auth/login', undefined, { email, password: pw })).body.token as string;

async function main() {
  const nuri = await login('customer01@nuri.test', 'Customer#2026');
  const staff = await login('staff1@nuri.test', 'Staff#2026');
  const admin = await login('admin@nuri.test', 'Admin#2026');

  section('출입증(토큰) 보안');
  let r = await call('GET', '/auth/me', nuri + 'x');
  check('바뀐 출입증은 거절', r.status === 401, String(r.status));
  r = await call('GET', '/auth/me', 'abc.def.ghi');
  check('엉터리 출입증은 거절', r.status === 401, String(r.status));
  const secret = process.env.JWT_SECRET!;
  const expired = jwt.sign({ uid: 4 }, secret, { expiresIn: -10 });
  r = await call('GET', '/auth/me', expired);
  check('시간이 지난 출입증은 거절', r.status === 401 && String(r.body?.message).includes('시간'), `${r.status} ${r.body?.message}`);
  const wrongKey = jwt.sign({ uid: 1 }, 'another-secret');
  r = await call('GET', '/auth/me', wrongKey);
  check('다른 비밀 글자로 만든 출입증(관리자 번호 위조)은 거절', r.status === 401, String(r.status));
  const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"uid":1}').toString('base64url')}.`;
  r = await call('GET', '/auth/me', noneAlg);
  check('서명 없는(alg=none) 출입증은 거절', r.status === 401, String(r.status));

  section('입력 공격');
  r = await call('GET', `/reservations?status=${encodeURIComponent("' OR 1=1 --")}`, staff);
  check("SQL 주입 시도(status=' OR 1=1 --)는 0건으로 처리", r.status === 200 && r.body.total === 0, `${r.status} ${r.body?.total}`);
  r = await call('GET', `/employees?q=${encodeURIComponent("'; DROP TABLE users; --")}`, staff);
  check('SQL 주입 시도(q=; DROP TABLE)는 0건으로 처리', r.status === 200 && r.body.total === 0, `${r.status} ${r.body?.total}`);
  r = await call('GET', '/vehicles', nuri);
  check('주입 시도 뒤에도 테이블이 멀쩡함', r.status === 200 && r.body.length === 3, String(r.status));
  r = await call('GET', `/reservations?vehicleId=${encodeURIComponent('1 OR 1=1')}`, staff);
  check('숫자 칸에 글자를 넣어도 서버가 죽지 않음', r.status < 500, `${r.status} ${r.body?.message}`);
  r = await call('GET', `/reservations/abc`, staff);
  check('예약 번호에 글자를 넣어도 서버가 죽지 않음', r.status < 500, `${r.status} ${r.body?.message}`);
  r = await call('POST', '/auth/login', undefined, undefined, '{"email": "a@b.c", ');
  check('깨진 JSON 은 쉬운 말로 거절', r.status === 400 && typeof r.body?.message === 'string', `${r.status} ${JSON.stringify(r.body)}`);
  r = await call('POST', '/auth/login', undefined, undefined, 'x'.repeat(400 * 1024));
  check('너무 큰 요청(400KB)은 서버 오류 없이 거절', r.status === 400 || r.status === 413, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call('POST', '/auth/login', undefined, { email: { $ne: null }, password: { $ne: null } });
  check('이메일·비밀번호 칸에 객체를 넣어도 로그인되지 않음', r.status === 401 || r.status === 400, String(r.status));
  r = await call('POST', '/reservations', nuri, { vehicleId: 1, startAt: '2099-01-01T09:00', endAt: '2099-01-01T10:00', destination: '가'.repeat(101), passengerCount: 1 });
  check('목적지 100자 초과는 거절', r.status === 400, `${r.status} ${r.body?.message}`);
  r = await call('POST', '/reservations', nuri, { vehicleId: 1, startAt: '2099-02-31T09:00', endAt: '2099-02-31T10:00', destination: 'x', passengerCount: 1 });
  check('없는 날짜(2월 31일)는 거절', r.status === 400, `${r.status} ${r.body?.message}`);

  section('권한 우회 시도');
  r = await call('POST', '/auth/signup', undefined, { employeeNo: 'E010', name: '한재무', email: 'hack@nuri.test', password: 'Passw0rd!', role: '관리자' });
  if (r.status === 201 || r.status === 200) {
    const me = await call('GET', '/auth/me', r.body.token);
    check('가입할 때 role=관리자를 같이 보내도 고객으로만 만들어짐', me.body.role === '고객', me.body.role);
    // 되돌리기: 방금 만든 가입은 db:reset 때 지워져요.
  } else {
    check('가입 우회 시도(이미 가입된 사번이라 거절됨)', r.status === 400, `${r.status} ${r.body?.message}`);
  }
  r = await call('PATCH', '/accounts/1', staff, { role: '관리자' });
  check('일반 직원이 역할 변경을 시도하면 거절', r.status === 403, String(r.status));
  r = await call('GET', '/claims?mine=0&size=100', nuri);
  check('고객은 mine=0 으로 바꿔도 내 정산만 보임', r.status === 200 && r.body.items.every((c: any) => c.employeeName === '김누리'), `${r.status}`);
  r = await call('GET', '/employees?size=100', nuri);
  check('고객이 보는 직원 명부에는 면허·사번이 없음(이름·부서만)', r.status === 200 && r.body.items.every((e: any) => !('licenseStatus' in e) && !('employeeNo' in e)), JSON.stringify(r.body.items?.[0]));
  r = await call('GET', '/auth/me', nuri);
  check('내 정보 응답에 비밀번호 해시가 없음', r.status === 200 && !JSON.stringify(r.body).includes('password'), JSON.stringify(r.body));
  r = await call('GET', '/accounts', admin);
  check('계정 목록 응답에 비밀번호 해시가 없음', r.status === 200 && !JSON.stringify(r.body).toLowerCase().includes('hash'), '');
  r = await call('GET', '/reservations/1', undefined);
  check('로그인 없이 예약 상세를 열 수 없음', r.status === 401, String(r.status));
  r = await call('DELETE', '/maintenance/1', staff);
  check('일반 직원은 점검 삭제 불가(관리자만)', r.status === 403, String(r.status));

  // DB가 멀리(미국 등) 있으면 요청마다 왕복 시간이 더해져서 기준을 나눠요.
  const remoteDb = !/@(localhost|127.0.0.1)/.test(process.env.DATABASE_URL ?? '');
  const LIMIT = remoteDb ? 1500 : 300;
  section(`응답 속도 (${remoteDb ? '멀리 있는 Render DB' : '이 컴퓨터의 DB'} 기준, ${LIMIT}ms 안쪽)`);
  const timing: [string, string, string][] = [
    ['예약 목록(총무팀)', '/reservations?size=20', staff],
    ['예약 상세', '/reservations/1', staff],
    ['어드민 홈 통계', '/stats/home', staff],
    ['차량별 월 통계', '/stats/vehicles-monthly', staff],
    ['부서별 월 통계', '/stats/departments-monthly', staff],
    ['예약 현황표', '/reservations/availability', staff],
    ['내 예약 목록(고객)', '/reservations?mine=1', nuri],
  ];
  for (const [name, path, token] of timing) {
    const times: number[] = [];
    for (let i = 0; i < 8; i++) times.push((await call('GET', path, token)).ms);
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    console.log(`  ${med < LIMIT ? '통과' : '느림'}  ${name}: 중간값 ${med.toFixed(0)}ms (최대 ${times[times.length - 1].toFixed(0)}ms)`);
    check(`${name} 응답이 ${LIMIT}ms 안쪽`, med < LIMIT, `${med.toFixed(0)}ms`);
  }

  section('DB 안전장치 (1주차 과제 테이블과 섞이지 않게)');
  const env = { ...process.env, DB_SCHEMA: 'public' };
  const s = spawnSync('npx', ['tsx', 'scripts/db-init.ts'], { env, encoding: 'utf8', shell: true });
  check('DB_SCHEMA 가 hw2 가 아니면 초기화 스크립트가 시작을 거부', s.status !== 0 && /hw2/.test(s.stdout + s.stderr), (s.stdout + s.stderr).slice(0, 150));
  const s2 = spawnSync('npx', ['tsx', 'scripts/db-seed.ts'], { env, encoding: 'utf8', shell: true });
  check('가상 데이터 스크립트도 hw2 가 아니면 거부', s2.status !== 0 && /hw2/.test(s2.stdout + s2.stderr), (s2.stdout + s2.stderr).slice(0, 150));

  const url = process.env.DATABASE_URL!;
  const db = new pg.Client({ connectionString: url, ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : { rejectUnauthorized: false } });
  await db.connect();
  // public 에 users 가 이미 있으면(1주차 과제 등) 절대 만들지도 지우지도 않고, 건드리지 않았는지 행 수만 비교해요.
  const pubExisted = (await db.query(`SELECT to_regclass('public.users') AS t`)).rows[0].t !== null;
  const pubBefore = pubExisted ? (await db.query('SELECT count(*)::int AS n FROM public.users')).rows[0].n : 0;
  try {
    await db.query('CREATE TABLE IF NOT EXISTS hw2.week1_dummy (id int)');
    if (!pubExisted) await db.query('CREATE TABLE public.users (id int)'); // 1주차 과제와 이름이 같은 테이블이 public 에 있다고 가정(없을 때만 임시로 만들어요)
    const s3 = spawnSync('npx', ['tsx', 'scripts/db-init.ts', '--reset'], { env: process.env, encoding: 'utf8', shell: true });
    check('hw2 안에 이 과제 것이 아닌 테이블이 있으면 reset 도 멈춤', s3.status !== 0 && /week1_dummy/.test(s3.stdout + s3.stderr), (s3.stdout + s3.stderr).slice(0, 200));
    const still = await db.query(`SELECT count(*)::int AS n FROM hw2.users`);
    check('멈춘 뒤에도 hw2 의 우리 테이블 데이터가 그대로', still.rows[0].n > 0, String(still.rows[0].n));
    const pub = await db.query(`SELECT to_regclass('public.users') AS t`);
    check('public 의 같은 이름 테이블(users)은 건드리지 않음', pub.rows[0].t !== null);
    const mix = await db.query(`SELECT count(*)::int AS n FROM public.users`);
    check('public.users 는 그대로(행 수 변화 없음, 섞이지 않음)', mix.rows[0].n === pubBefore, `${pubBefore} → ${mix.rows[0].n}`);
  } finally {
    await db.query('DROP TABLE IF EXISTS hw2.week1_dummy').catch(() => undefined);
    if (!pubExisted) await db.query('DROP TABLE IF EXISTS public.users').catch(() => undefined); // 테스트가 만든 것만 지워요
    await db.end();
  }

  console.log(`\n결과: 통과 ${pass}개, 실패 ${fail}개`);
  // 테스트가 만든 가입(예: 한재무)을 남기지 않도록 가상 데이터를 처음 상태로 되돌려요.
  spawnSync('npx', ['tsx', 'scripts/db-init.ts', '--reset'], { env: process.env, shell: true });
  spawnSync('npx', ['tsx', 'scripts/db-seed.ts'], { env: process.env, shell: true });
  console.log('가상 데이터를 처음 상태로 되돌렸어요.');
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('테스트 중단:', e.message);
  process.exitCode = 1;
});
