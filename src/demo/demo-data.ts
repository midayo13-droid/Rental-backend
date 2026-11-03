// 가상 데이터 — scripts/db-seed.ts 와 어드민의 "가상 데이터 다시 채우기"가 같이 써요.
// 모든 이름·계정·차량은 가상이에요.
import bcrypt from 'bcryptjs';

/** SQL 한 줄을 실행해서 결과 줄들을 돌려주는 함수 (pg Client 든 트랜잭션이든 맞춰서 넘겨요) */
export type Run = (sql: string, params?: any[]) => Promise<any[]>;

// ---------- 한국 시각 도우미 ----------
const kst = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const nowKst = () => kst.format(new Date()).replace(' ', 'T');
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addMin = (s: string, m: number) => new Date(Date.parse(`${s}Z`) + m * 60000).toISOString().slice(0, 19);

// ---------- 가상 데이터 ----------
const DEPTS = ['총무팀', '영업팀', '개발팀', '마케팅팀', '재무팀'];

type Emp = {
  key: string; no: string; name: string; dept: string; lic: '미등록' | '승인 대기' | '승인'; licDays?: number;
  account?: { email: string; role: '고객' | '일반 직원' | '관리자'; password: string };
};
const EMPS: Emp[] = [
  { key: 'admin', no: 'E001', name: '김관리', dept: '총무팀', lic: '승인', licDays: 400, account: { email: 'admin@nuri.test', role: '관리자', password: 'Admin#2026' } },
  { key: 'staff1', no: 'E002', name: '이총무', dept: '총무팀', lic: '승인', licDays: 300, account: { email: 'staff1@nuri.test', role: '일반 직원', password: 'Staff#2026' } },
  { key: 'staff2', no: 'E003', name: '박총무', dept: '총무팀', lic: '승인', licDays: 25, account: { email: 'staff2@nuri.test', role: '일반 직원', password: 'Staff#2026' } },
  { key: 'nuri', no: 'E004', name: '김누리', dept: '영업팀', lic: '승인', licDays: 18, account: { email: 'customer01@nuri.test', role: '고객', password: 'Customer#2026' } },
  { key: 'sales', no: 'E005', name: '박영업', dept: '영업팀', lic: '승인', licDays: 200, account: { email: 'sales@nuri.test', role: '고객', password: 'Customer#2026' } },
  { key: 'dev', no: 'E006', name: '이개발', dept: '개발팀', lic: '승인', licDays: 300, account: { email: 'dev@nuri.test', role: '고객', password: 'Customer#2026' } },
  { key: 'dev2', no: 'E007', name: '윤개발', dept: '개발팀', lic: '미등록' },
  { key: 'mk1', no: 'E008', name: '최마케', dept: '마케팅팀', lic: '승인 대기', licDays: 250 },
  { key: 'mk2', no: 'E009', name: '정마케', dept: '마케팅팀', lic: '승인', licDays: 5, account: { email: 'mk@nuri.test', role: '고객', password: 'Customer#2026' } },
  { key: 'staff3', no: 'E011', name: '송총무', dept: '총무팀', lic: '미등록' },
  { key: 'fin', no: 'E010', name: '한재무', dept: '재무팀', lic: '승인', licDays: 90 },
];

const VEHICLES = [
  { key: 1, model: '쏘나타', plate: '12가 3456', seats: 5, odo: 38000 },
  { key: 2, model: '카니발', plate: '34나 7788', seats: 7, odo: 52000 },
  { key: 3, model: '아반떼', plate: '56다 1122', seats: 5, odo: 21000 },
];

type Guest = { name: string; org?: string };
type Res = {
  v: number; driver: string; start: [number, string]; end: [number, string]; dest: string; pax: number;
  status: '예약됨' | '운행 중' | '확인 대기' | '반납' | '취소'; km?: number; comp?: (string | Guest)[];
  fuel?: { day: number; amount: number; liters: number; receipt?: boolean }[]; confirmedBy?: string; smoking?: boolean;
  accident?: { day: number; desc: string; reported: boolean };
};
const RES: Res[] = [
  // 쏘나타
  { v: 1, driver: 'nuri', start: [-14, '09:00'], end: [-14, '17:00'], dest: '서울 본사', pax: 1, status: '반납', km: 60, fuel: [{ day: -14, amount: 30000, liters: 16.2, receipt: true }], confirmedBy: 'staff1' },
  { v: 1, driver: 'nuri', start: [-9, '09:00'], end: [-9, '18:00'], dest: '수원 거래처', pax: 2, status: '반납', km: 86, comp: ['sales'], fuel: [{ day: -9, amount: 52000, liters: 28.5, receipt: true }], confirmedBy: 'staff1' },
  { v: 1, driver: 'sales', start: [-5, '08:00'], end: [-5, '19:00'], dest: '인천 출장', pax: 1, status: '반납', km: 126, fuel: [{ day: -5, amount: 61000, liters: 33.0 }], confirmedBy: 'staff2', smoking: true,
    accident: { day: -5, desc: '주차장에서 후진 중 기둥에 접촉(뒷범퍼 긁힘)', reported: false } },
  { v: 1, driver: 'dev', start: [-2, '10:00'], end: [-2, '17:00'], dest: '판교 세미나', pax: 3, status: '확인 대기', km: 85, comp: ['dev2', { name: '정고객', org: '(주)한빛' }], fuel: [{ day: -2, amount: 40000, liters: 22.0 }] },
  { v: 1, driver: 'nuri', start: [1, '13:00'], end: [1, '17:00'], dest: '서울 본사', pax: 1, status: '예약됨' },
  { v: 1, driver: 'mk2', start: [8, '09:00'], end: [8, '18:00'], dest: '대전 출장', pax: 2, status: '예약됨', comp: ['fin'] },
  // 카니발
  { v: 2, driver: 'staff2', start: [-7, '09:00'], end: [-7, '20:00'], dest: '대구 출장', pax: 4, status: '반납', km: 480, comp: ['staff1', 'nuri', { name: '이거래', org: '(주)가람' }],
    fuel: [{ day: -7, amount: 70000, liters: 38.0, receipt: true }, { day: -7, amount: 95000, liters: 50.0 }], confirmedBy: 'staff1',
    accident: { day: -7, desc: '휴게소 주차 중 옆 차량과 가벼운 접촉', reported: true } },
  { v: 2, driver: 'admin', start: [-3, '09:00'], end: [-3, '18:00'], dest: '본사 외근', pax: 1, status: '반납', km: 51, confirmedBy: 'staff1' },
  { v: 2, driver: 'staff1', start: [-1, '09:00'], end: [-1, '18:00'], dest: '관청 방문', pax: 1, status: '확인 대기', km: 40 },
  { v: 2, driver: 'sales', start: [0, '00:00'], end: [1, '12:00'], dest: '부산 출장', pax: 3, status: '운행 중', comp: ['nuri', 'fin'], fuel: [{ day: 0, amount: 48000, liters: 26.0 }] },
  { v: 2, driver: 'nuri', start: [4, '09:00'], end: [4, '18:00'], dest: '일정 변경(취소)', pax: 1, status: '취소' },
  // 아반떼
  { v: 3, driver: 'mk2', start: [-12, '10:00'], end: [-12, '15:00'], dest: '마케팅 행사', pax: 3, status: '반납', km: 64, comp: ['mk1', 'fin'], fuel: [{ day: -12, amount: 30000, liters: 16.0, receipt: true }], confirmedBy: 'staff2' },
  { v: 3, driver: 'dev', start: [-1, '09:00'], end: [-1, '15:00'], dest: '성남 고객사', pax: 1, status: '운행 중' }, // 미반납
  { v: 3, driver: 'sales', start: [3, '09:00'], end: [3, '12:00'], dest: '근처 외근', pax: 1, status: '예약됨' },

  // ---- 이번 달 초(지난 며칠): 반납까지 끝난 운행을 더 채워요 ----
  { v: 1, driver: 'staff2', start: [-3, '09:00'], end: [-3, '17:00'], dest: '관청 서류 제출', pax: 1, status: '반납', km: 74, fuel: [{ day: -3, amount: 35000, liters: 19.0 }], confirmedBy: 'staff1' },
  { v: 3, driver: 'sales', start: [-3, '09:00'], end: [-3, '13:00'], dest: '인근 거래처', pax: 1, status: '반납', km: 38, confirmedBy: 'staff2' },
  { v: 3, driver: 'mk2', start: [-2, '14:00'], end: [-2, '18:00'], dest: '매장 점검', pax: 1, status: '반납', km: 52, fuel: [{ day: -2, amount: 25000, liters: 13.5, receipt: true }], confirmedBy: 'staff1' },
  { v: 2, driver: 'nuri', start: [-2, '09:00'], end: [-2, '18:00'], dest: '인천 지사', pax: 2, status: '반납', km: 96, comp: ['sales'], fuel: [{ day: -2, amount: 66000, liters: 36.0 }], confirmedBy: 'staff2' },

  // ---- 앞으로 11월 중순(오늘 +11일)까지의 예약 ----
  { v: 3, driver: 'mk2', start: [2, '13:00'], end: [2, '17:00'], dest: '근처 매장 점검', pax: 1, status: '예약됨' },
  { v: 2, driver: 'staff1', start: [2, '09:00'], end: [2, '18:00'], dest: '관청 합동 방문', pax: 3, status: '예약됨', comp: ['staff2', 'admin'] },
  { v: 1, driver: 'dev', start: [3, '09:00'], end: [3, '12:00'], dest: '판교 사옥', pax: 1, status: '예약됨' },
  { v: 2, driver: 'mk2', start: [4, '09:00'], end: [4, '18:00'], dest: '고객사 행사 지원', pax: 4, status: '예약됨', comp: ['mk1', 'fin', { name: '오고객', org: '(주)새솔' }] },
  { v: 1, driver: 'sales', start: [5, '10:00'], end: [5, '19:00'], dest: '천안 출장', pax: 2, status: '예약됨', comp: ['nuri'] },
  { v: 3, driver: 'nuri', start: [5, '09:00'], end: [5, '18:00'], dest: '고객사 방문', pax: 1, status: '예약됨' },
  { v: 2, driver: 'dev', start: [6, '08:00'], end: [6, '20:00'], dest: '광주 출장', pax: 5, status: '예약됨', comp: ['sales', 'dev2', 'nuri', { name: '한거래', org: '(주)대한' }] },
  { v: 3, driver: 'staff2', start: [7, '10:00'], end: [7, '15:00'], dest: '관공서 방문', pax: 2, status: '예약됨', comp: ['staff1'] },
  { v: 2, driver: 'sales', start: [9, '09:00'], end: [9, '12:00'], dest: '세미나 참석', pax: 2, status: '예약됨', comp: ['fin'] },
  { v: 3, driver: 'dev', start: [9, '09:00'], end: [9, '18:00'], dest: '성남 고객사', pax: 1, status: '예약됨' },
  { v: 1, driver: 'staff2', start: [10, '09:00'], end: [10, '18:00'], dest: '본사 회의', pax: 1, status: '예약됨' },
  { v: 1, driver: 'nuri', start: [11, '13:00'], end: [11, '17:00'], dest: '서울 본사', pax: 1, status: '예약됨' },
  { v: 2, driver: 'admin', start: [11, '14:00'], end: [11, '18:00'], dest: '본사 외근', pax: 1, status: '예약됨' },
];

type Claim = { emp: string; day: number; dest: string; km: number; status: '신청됨' | '승인됨' | '반려됨' | '취소'; by?: string; reason?: string };
const CLAIMS: Claim[] = [
  { emp: 'nuri', day: -4, dest: '고객사 방문', km: 120, status: '승인됨', by: 'staff1' },
  { emp: 'sales', day: -3, dest: '지방 출장', km: 260, status: '신청됨' },
  { emp: 'dev', day: -10, dest: '판교 교육', km: 80, status: '반려됨', by: 'staff2', reason: '같은 날 법인차량을 이용하셨어요. 확인 후 다시 신청해 주세요.' },
  { emp: 'mk2', day: -6, dest: '행사장 답사', km: 40, status: '신청됨' },
  { emp: 'staff1', day: -2, dest: '은행 업무', km: 30, status: '신청됨' },
  { emp: 'sales', day: -15, dest: '거래처 미팅', km: 90, status: '승인됨', by: 'staff1' },
  { emp: 'fin', day: -1, dest: '세무서', km: 55, status: '취소' },
  { emp: 'dev', day: -3, dest: '교육 참석', km: 70, status: '신청됨' },
  { emp: 'mk2', day: -2, dest: '행사 사전 답사', km: 45, status: '승인됨', by: 'staff2' },
  { emp: 'sales', day: -1, dest: '근처 미팅', km: 25, status: '신청됨' },
  { emp: 'staff2', day: -4, dest: '우체국 업무', km: 12, status: '승인됨', by: 'staff1' },
];

export const DEMO_COUNTS = { departments: DEPTS.length, employees: EMPS.length, accounts: EMPS.filter((e) => e.account).length, vehicles: VEHICLES.length, reservations: RES.length, claims: CLAIMS.length };

/** 부서·직원 명부·계정·차량 (처음 한 번만) */
export async function seedBase(run: Run) {
  const dept = new Map<string, number>();
  for (const d of DEPTS) dept.set(d, (await run('INSERT INTO departments (name) VALUES ($1) RETURNING id', [d]))[0].id);
  const today = nowKst().slice(0, 10);
  for (const e of EMPS) {
    let userId: number | null = null;
    if (e.account) {
      const u = await run('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id', [
        e.account.email, await bcrypt.hash(e.account.password, 10), e.account.role,
      ]);
      userId = u[0].id;
    }
    await run(
      `INSERT INTO employees (employee_no, name, department_id, user_id, license_expiry, license_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.no, e.name, dept.get(e.dept), userId, e.licDays !== undefined ? addDays(today, e.licDays) : null, e.lic],
    );
  }
  for (const v of VEHICLES) {
    await run('INSERT INTO vehicles (model, plate_no, seat_count, initial_odometer) VALUES ($1, $2, $3, $4)', [v.model, v.plate, v.seats, v.odo]);
  }
}

/** 점검·예약·운행·동승자·주유·사고·개인 차량 정산 (계정·직원 명부·차량은 그대로 두고 이 부분만 채워요) */
export async function seedActivity(run: Run) {
  const nowStr = nowKst();
  const today = nowStr.slice(0, 10);
  const dayOf = (n: number) => addDays(today, n);
  const at = (day: number, hm: string) => `${dayOf(day)}T${hm}:00`;

  const empRows = await run('SELECT id, employee_no AS empno, user_id AS uid, department_id AS did FROM employees');
  const emp = new Map<string, { id: number; userId: number | null; deptId: number }>();
  for (const e of EMPS) {
    const row = empRows.find((r) => r.empno === e.no);
    if (!row) throw new Error(`직원 명부에 ${e.no} 가 없어요. 먼저 db:reset 으로 처음부터 채워 주세요.`);
    emp.set(e.key, { id: row.id, userId: row.uid ?? null, deptId: row.did });
  }
  const adminUser = (await run(`SELECT id FROM users WHERE role = '관리자' ORDER BY id LIMIT 1`))[0]?.id ?? null;
  const vehRows = await run('SELECT id, plate_no AS plate, initial_odometer AS odo FROM vehicles');
  const veh = new Map<number, { id: number; running: number }>();
  for (const v of VEHICLES) {
    const row = vehRows.find((r) => r.plate === v.plate);
    if (!row) throw new Error(`차량 ${v.plate} 가 없어요. 먼저 db:reset 으로 처음부터 채워 주세요.`);
    veh.set(v.key, { id: row.id, running: row.odo });
  }

  await run(`INSERT INTO maintenance_schedules (vehicle_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4)`, [veh.get(3)!.id, dayOf(10), dayOf(12), '정기 점검']);
  await run(`INSERT INTO maintenance_schedules (vehicle_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4)`, [veh.get(1)!.id, dayOf(-20), dayOf(-19), '엔진오일 교환']);
  await run(`INSERT INTO maintenance_schedules (vehicle_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4)`, [veh.get(2)!.id, dayOf(13), dayOf(14), '타이어 교체']);

  // 차량별로 시간 순서대로 주행거리를 이어 붙여요.
  const sorted = [...RES].sort((a, b) => (at(...a.start) < at(...b.start) ? -1 : 1));
  for (const r of sorted) {
    const d = emp.get(r.driver)!;
    const v = veh.get(r.v)!;
    const startAt = at(...r.start);
    const endAt = at(...r.end);
    const res = await run(
      `INSERT INTO reservations (vehicle_id, driver_id, department_id, start_at, end_at, destination, passenger_count, status, created_by, canceled_by, canceled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [v.id, d.id, d.deptId, startAt, endAt, r.dest, r.pax, r.status, d.userId ?? adminUser,
       r.status === '취소' ? d.userId : null, r.status === '취소' ? nowStr : null],
    );
    const resId = res[0].id;
    for (const c of r.comp ?? []) {
      if (typeof c === 'string') await run('INSERT INTO reservation_companions (reservation_id, employee_id) VALUES ($1, $2)', [resId, emp.get(c)!.id]);
      else await run('INSERT INTO reservation_companions (reservation_id, guest_name, guest_org) VALUES ($1, $2, $3)', [resId, c.name, c.org ?? null]);
    }
    if (['운행 중', '확인 대기', '반납'].includes(r.status)) {
      const startOdo = v.running;
      let endOdo: number | null = null, returnAt: string | null = null, confirmedBy: number | null = null, confirmedAt: string | null = null;
      if (r.status === '확인 대기' || r.status === '반납') {
        endOdo = startOdo + (r.km ?? 50);
        returnAt = addMin(endAt, -20);
        v.running = endOdo;
      }
      if (r.status === '반납') {
        confirmedBy = emp.get(r.confirmedBy!)!.userId;
        confirmedAt = addMin(endAt, 90);
      }
      const trip = await run(
        `INSERT INTO trips (reservation_id, start_odometer, departed_at, end_odometer, return_entered_at, confirmed_by, confirmed_at, smoking_violation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [resId, startOdo, addMin(startAt, 5), endOdo, returnAt, confirmedBy, confirmedAt, r.smoking === true],
      );
      for (const f of r.fuel ?? []) {
        await run('INSERT INTO fuel_records (trip_id, fueled_on, amount, liters, receipt_submitted) VALUES ($1, $2, $3, $4, $5)', [trip[0].id, dayOf(f.day), f.amount, f.liters, f.receipt === true]);
      }
      if (r.accident) {
        await run('INSERT INTO accidents (trip_id, accident_date, description, report_submitted, created_by) VALUES ($1, $2, $3, $4, $5)',
          [trip[0].id, dayOf(r.accident.day), r.accident.desc, r.accident.reported, emp.get('staff1')!.userId]);
      }
    }
  }

  for (const c of CLAIMS) {
    const e = emp.get(c.emp)!;
    await run(
      `INSERT INTO personal_vehicle_claims (employee_id, department_id, travel_date, destination, distance_km, rate_per_km, status, decided_by, decided_at, reject_reason, canceled_at)
       VALUES ($1, $2, $3, $4, $5, 200, $6, $7, $8, $9, $10)`,
      [e.id, e.deptId, dayOf(c.day), c.dest, c.km, c.status, c.by ? emp.get(c.by)!.userId : null,
       c.by ? `${dayOf(c.day + 1)}T10:00:00` : null, c.reason ?? null, c.status === '취소' ? nowStr : null],
    );
  }
}
