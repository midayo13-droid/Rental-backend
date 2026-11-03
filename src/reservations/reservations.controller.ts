import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { isStaff, Roles } from '../auth/auth.js';
import { query, queryOne, tx, type Q } from '../common/db.js';
import { bad, conflict, forbidden, josa, notFound, pageParams, pageResult, posInt, str } from '../common/http.js';
import { addDays, human, humanDate, ms, nowKst, normDate, normDateTime, todayKst } from '../common/time.js';

const BUFFER_MIN = 30; // 반납 후 여유 시간 [V-4]
const OVERDUE_MIN = 30; // 미반납 판정 [운-8]
const WARN_KM = 500; // 거리 경고 [운-3]

const LIST_SELECT = `
  SELECT r.id, r.vehicle_id, v.model, v.plate_no, r.driver_id, e.name AS driver_name,
         r.department_id, d.name AS department_name,
         r.start_at, r.end_at, r.destination, r.passenger_count, r.status, r.created_at,
         t.id AS trip_id, t.start_odometer, t.end_odometer, t.confirmed_by, t.confirmed_at, t.smoking_violation,
         (r.status = '운행 중' AND $1::timestamp > r.end_at + interval '${OVERDUE_MIN} minutes') AS overdue,
         (t.end_odometer IS NOT NULL AND t.end_odometer - t.start_odometer > ${WARN_KM}) AS distance_warning
    FROM reservations r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN employees e ON e.id = r.driver_id
    JOIN departments d ON d.id = r.department_id
    LEFT JOIN trips t ON t.reservation_id = r.id`;

async function loadReservation(q: Q, id: number, lock = false) {
  const r = await q.queryOne<any>(
    `SELECT r.*, v.model, v.plate_no, v.seat_count, v.initial_odometer,
            e.name AS driver_name, e.user_id AS driver_user_id, d.name AS department_name
       FROM reservations r
       JOIN vehicles v ON v.id = r.vehicle_id
       JOIN employees e ON e.id = r.driver_id
       JOIN departments d ON d.id = r.department_id
      WHERE r.id = $1 ${lock ? 'FOR UPDATE OF r' : ''}`,
    [id],
  );
  if (!r) throw notFound('예약을 찾을 수 없어요.');
  return r;
}

function mustSee(user: any, r: any) {
  if (isStaff(user.role) || r.driverUserId === user.id) return;
  throw forbidden('내 예약만 볼 수 있어요.');
}
function mustBeDriver(user: any, r: any) {
  if (r.driverUserId !== user.id) throw forbidden('내 예약만 처리할 수 있어요.');
}

@Controller('reservations')
export class ReservationsController {
  /** 반납 예정 시각 +30분이 지났는데 아직 도착 입력이 없는 예약 [운-8] */
  @Roles('staff')
  @Get('overdue')
  async overdue() {
    return query(
      `${LIST_SELECT}
        WHERE r.status = '운행 중' AND $1::timestamp > r.end_at + interval '${OVERDUE_MIN} minutes'
        ORDER BY r.end_at`,
      [nowKst()],
    ).then((rows) =>
      rows.map((r: any) => ({ ...r, overdueMinutes: Math.floor((ms(nowKst()) - ms(r.endAt)) / 60000) })),
    );
  }

  /** 날짜별 차량 예약 현황 (D 선택: 현황표) */
  @Get('availability')
  async availability(@Req() req: any, @Query('date') date?: string) {
    const day = date ? normDate(date, '날짜') : todayKst();
    const staff = isStaff(req.user.role);
    const [vehicles, reservations, maintenance] = await Promise.all([
      query<any>('SELECT id, model, plate_no, seat_count FROM vehicles ORDER BY id'),
      query<any>(
      `SELECT r.id, r.vehicle_id, r.start_at, r.end_at, r.status, e.name AS driver_name, d.name AS department_name
         FROM reservations r JOIN employees e ON e.id = r.driver_id JOIN departments d ON d.id = r.department_id
        WHERE r.status <> '취소' AND r.start_at < $2::timestamp AND r.end_at > $1::timestamp
        ORDER BY r.start_at`,
        [`${day}T00:00:00`, `${addDays(day, 1)}T00:00:00`],
      ),
      query<any>(
        `SELECT vehicle_id, start_date, end_date, reason FROM maintenance_schedules
          WHERE start_date <= $1::date AND end_date >= $1::date`,
        [day],
      ),
    ]);
    return {
      date: day,
      vehicles: vehicles.map((v) => ({
        ...v,
        reservations: reservations
          .filter((r) => r.vehicleId === v.id)
          .map((r) =>
            staff ? r : { id: r.id, startAt: r.startAt, endAt: r.endAt, status: r.status, vehicleId: r.vehicleId },
          ),
        maintenance: maintenance.filter((m) => m.vehicleId === v.id),
      })),
    };
  }

  /** 예약 목록: 고객은 내 것만, 총무팀은 전체(또는 mine=1 로 내 것만) */
  @Get()
  async list(@Req() req: any, @Query() q: any) {
    const staff = isStaff(req.user.role);
    const p = pageParams(q);
    const params: any[] = [nowKst()];
    const where: string[] = [];
    if (!staff || q?.mine === '1') {
      params.push(req.user.id);
      where.push(`e.user_id = $${params.length}`);
    }
    if (q?.status) {
      params.push(String(q.status));
      where.push(`r.status = $${params.length}`);
    }
    if (q?.vehicleId) {
      params.push(Number(q.vehicleId));
      where.push(`r.vehicle_id = $${params.length}`);
    }
    if (staff && q?.departmentId) {
      params.push(Number(q.departmentId));
      where.push(`r.department_id = $${params.length}`);
    }
    if (q?.from) {
      params.push(normDate(q.from, '시작 날짜'));
      where.push(`r.end_at::date >= $${params.length}::date`);
    }
    if (q?.to) {
      params.push(normDate(q.to, '끝 날짜'));
      where.push(`r.start_at::date <= $${params.length}::date`);
    }
    if (staff && q?.q) {
      params.push(`%${String(q.q).trim()}%`);
      where.push(`(e.name ILIKE $${params.length} OR r.destination ILIKE $${params.length})`);
    }
    const cond = where.length ? `AND ${where.join(' AND ')}` : '';
    const limit = p.paged ? `LIMIT ${p.size} OFFSET ${p.offset}` : 'LIMIT 1000';
    const [countRow, items] = await Promise.all([
      queryOne<any>(
        `SELECT count(*) AS n FROM reservations r JOIN employees e ON e.id = r.driver_id
          WHERE $1::timestamp IS NOT NULL ${cond}`,
        params,
      ),
      query<any>(
        `${LIST_SELECT} WHERE $1::timestamp IS NOT NULL ${cond} ORDER BY r.start_at DESC, r.id DESC ${limit}`,
        params,
      ),
    ]);
    return pageResult(items, countRow!.n, p);
  }

  @Get(':id')
  async detail(@Req() req: any, @Param('id') id: string) {
    const rid = Number(id);
    // 예약·운행·동승자는 서로 의존하지 않아서 한꺼번에 가져와요.
    const [r, trip, companions] = await Promise.all([
      loadReservation({ query, queryOne } as Q, rid),
      queryOne<any>(
        `SELECT t.*, u.email AS confirmed_by_email, ce.name AS confirmed_by_name
           FROM trips t LEFT JOIN users u ON u.id = t.confirmed_by LEFT JOIN employees ce ON ce.user_id = t.confirmed_by
          WHERE t.reservation_id = $1`,
        [rid],
      ),
      query(
        `SELECT c.id, c.employee_id, COALESCE(e.name, c.guest_name) AS name, c.guest_org,
                (c.employee_id IS NULL) AS is_guest, d.name AS department_name
           FROM reservation_companions c LEFT JOIN employees e ON e.id = c.employee_id LEFT JOIN departments d ON d.id = e.department_id
          WHERE c.reservation_id = $1 ORDER BY c.id`,
        [rid],
      ),
    ]);
    mustSee(req.user, r);
    const [fuel, accidents] = trip
      ? await Promise.all([
          query('SELECT id, fueled_on, amount, liters, receipt_submitted FROM fuel_records WHERE trip_id = $1 ORDER BY fueled_on, id', [trip.id]),
          query('SELECT id, accident_date, description, report_submitted FROM accidents WHERE trip_id = $1 ORDER BY id', [trip.id]),
        ])
      : [[], []];
    const now = nowKst();
    return {
      ...r,
      driverUserId: undefined,
      isMine: r.driverUserId === req.user.id,
      overdue: r.status === '운행 중' && ms(now) > ms(r.endAt) + OVERDUE_MIN * 60000,
      trip,
      companions,
      fuel,
      accidents,
    };
  }

  /** 예약 신청 — 규칙은 모두 여기서 지켜요. [R-1]~[R-11] */
  @Post()
  async create(@Req() req: any, @Body() body: any) {
    if (!req.user.employeeId) throw bad('직원 명부에 연결된 계정이 아니라서 예약할 수 없어요.');
    const vehicleId = posInt(body?.vehicleId, '차량');
    const startAt = normDateTime(body?.startAt, '시작 시각');
    const endAt = normDateTime(body?.endAt, '끝 시각');
    const destination = str(body?.destination, '목적지', { max: 100 });
    const pax = posInt(body?.passengerCount, '탑승 인원');
    const companionsIn: any[] = Array.isArray(body?.companions) ? body.companions : [];

    if (ms(endAt) <= ms(startAt)) throw bad('끝나는 시각은 시작하는 시각보다 늦어야 해요.'); // [R-2]
    if (ms(endAt) - ms(startAt) > 72 * 3600000) throw bad('한 번에 3일(72시간)까지만 빌릴 수 있어요.'); // [R-3]
    if (startAt < `${addDays(todayKst(), 1)}T00:00:00`) {
      throw bad('차량은 사용 하루 전까지 신청해야 해요. 내일 이후 날짜로 골라 주세요.'); // [R-4]
    }

    return tx(async (q) => {
      // 같은 차에 동시에 신청이 몰려도 순서대로 처리되게 차량 줄을 잠가요.
      const v = await q.queryOne<any>('SELECT id, model, seat_count FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
      if (!v) throw notFound('차량을 찾을 수 없어요.');
      if (pax > v.seatCount) throw bad(`${josa(v.model, '은/는')} ${v.seatCount}명까지 탈 수 있어요.`); // [R-5]

      const emp = await q.queryOne<any>('SELECT id, department_id, license_status, license_expiry FROM employees WHERE id = $1', [
        req.user.employeeId,
      ]);
      if (!emp) throw bad('직원 정보를 찾을 수 없어요.');
      if (emp.licenseStatus === '미등록') throw bad('면허 만료일을 등록하고 총무팀 승인을 받아야 차량을 빌릴 수 있어요.'); // [R-7]
      if (emp.licenseStatus === '승인 대기') throw bad('면허가 아직 총무팀 승인 전이에요. 승인된 뒤에 예약할 수 있어요.');
      if (endAt.slice(0, 10) > emp.licenseExpiry) {
        throw bad(`면허가 ${humanDate(emp.licenseExpiry)}에 만료돼서 그 날짜 이후까지는 빌릴 수 없어요.`); // [R-8]
      }

      // 동승자 [R-9]
      const companions: { employeeId?: number; guestName?: string; guestOrg?: string }[] = [];
      if (pax === 1) {
        if (companionsIn.length > 0) throw bad('혼자 타시면 동승자를 선택하지 않아요.');
      } else {
        if (companionsIn.length !== pax - 1) throw bad(`탑승 인원이 ${pax}명이면 동승자를 ${pax - 1}명 선택해 주세요.`);
        const seen = new Set<number>();
        for (const c of companionsIn) {
          if (c?.employeeId) {
            const eid = Number(c.employeeId);
            if (eid === emp.id) throw bad('운전자 본인은 동승자로 선택할 수 없어요.');
            if (seen.has(eid)) throw bad('같은 동승자를 두 번 선택할 수 없어요.');
            if (!(await q.queryOne('SELECT 1 FROM employees WHERE id = $1', [eid]))) throw bad('동승자는 직원 명부의 직원이어야 해요.');
            seen.add(eid);
            companions.push({ employeeId: eid });
          } else {
            const name = str(c?.guestName, '외부 손님 이름', { max: 50 });
            companions.push({ guestName: name, guestOrg: str(c?.guestOrg, '소속', { max: 50, optional: true }) || undefined });
          }
        }
      }

      // 점검 기간 겹침 [R-6]
      const maint = await q.queryOne<any>(
        `SELECT start_date, end_date, reason FROM maintenance_schedules
          WHERE vehicle_id = $1 AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
        [vehicleId, startAt.slice(0, 10), endAt.slice(0, 10)],
      );
      if (maint) throw bad(`그 기간에는 ${v.model} 점검이 있어요(${humanDate(maint.startDate)}~${humanDate(maint.endDate)}, ${maint.reason}).`);

      // 같은 차 시간 겹침(+반납 후 30분 여유) [R-1]
      const clash = await q.queryOne<any>(
        `SELECT 1 FROM reservations
          WHERE vehicle_id = $1 AND status <> '취소'
            AND tsrange(start_at, end_at + interval '${BUFFER_MIN} minutes') && tsrange($2::timestamp, $3::timestamp + interval '${BUFFER_MIN} minutes')`,
        [vehicleId, startAt, endAt],
      );
      if (clash) throw conflict(`그 시간에는 ${josa(v.model, '이/가')} 이미 예약이 있어요. 앞뒤 30분은 정리 시간이라 비워 둬요.`);

      // 같은 운전자 시간 겹침 [R-11]
      const mine = await q.queryOne<any>(
        `SELECT 1 FROM reservations
          WHERE driver_id = $1 AND status <> '취소' AND tsrange(start_at, end_at) && tsrange($2::timestamp, $3::timestamp)`,
        [emp.id, startAt, endAt],
      );
      if (mine) throw conflict('그 시간에는 이미 다른 차를 예약하셨어요.');

      const row = await q.queryOne<any>(
        `INSERT INTO reservations (vehicle_id, driver_id, department_id, start_at, end_at, destination, passenger_count, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [vehicleId, emp.id, emp.departmentId, startAt, endAt, destination, pax, req.user.id],
      );
      for (const c of companions) {
        await q.query(
          'INSERT INTO reservation_companions (reservation_id, employee_id, guest_name, guest_org) VALUES ($1, $2, $3, $4)',
          [row!.id, c.employeeId ?? null, c.guestName ?? null, c.guestOrg ?? null],
        );
      }
      return { id: row!.id };
    });
  }

  /** 취소: 본인은 출발 시각 전까지, 총무팀은 대신 취소 [취-1] [취-2] */
  @Post(':id/cancel')
  async cancel(@Req() req: any, @Param('id') id: string) {
    return tx(async (q) => {
      const r = await loadReservation(q, Number(id), true);
      if (!isStaff(req.user.role) && r.driverUserId !== req.user.id) throw forbidden('내 예약만 취소할 수 있어요.');
      if (r.status === '취소') throw bad('이미 취소된 예약이에요.');
      if (r.status !== '예약됨') throw bad('이미 출발한 예약은 취소할 수 없어요.');
      if (ms(nowKst()) >= ms(r.startAt)) throw bad('출발 시각이 지나서 취소할 수 없어요. 총무팀에 문의해 주세요.');
      await q.query(`UPDATE reservations SET status = '취소', canceled_by = $1, canceled_at = $2 WHERE id = $3`, [
        req.user.id, nowKst(), r.id,
      ]);
      return { ok: true };
    });
  }

  /** 출발: 출발 거리는 직전 운행의 도착 거리가 자동으로 들어가요. [운-2] */
  @Post(':id/depart')
  async depart(@Req() req: any, @Param('id') id: string) {
    return tx(async (q) => {
      const r = await loadReservation(q, Number(id), true);
      mustBeDriver(req.user, r);
      if (r.status !== '예약됨') throw bad('출발할 수 있는 상태가 아니에요.');
      const now = nowKst();
      if (now.slice(0, 10) < r.startAt.slice(0, 10)) throw bad(`출발은 예약한 날(${humanDate(r.startAt.slice(0, 10))})부터 할 수 있어요.`);
      if (ms(now) > ms(r.endAt)) throw bad('반납 예정 시각이 지난 예약이에요. 총무팀에 문의해 주세요.');
      await q.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [r.vehicleId]);
      if (await q.queryOne(`SELECT 1 FROM reservations WHERE vehicle_id = $1 AND status = '운행 중'`, [r.vehicleId])) {
        throw conflict('앞 운행이 아직 반납되지 않았어요. 총무팀에 문의해 주세요.');
      }
      const last = await q.queryOne<any>(
        `SELECT t.end_odometer FROM trips t JOIN reservations x ON x.id = t.reservation_id
          WHERE x.vehicle_id = $1 AND t.end_odometer IS NOT NULL ORDER BY t.return_entered_at DESC, t.id DESC LIMIT 1`,
        [r.vehicleId],
      );
      const startOdometer = last ? last.endOdometer : r.initialOdometer;
      await q.query('INSERT INTO trips (reservation_id, start_odometer, departed_at) VALUES ($1, $2, $3)', [r.id, startOdometer, now]);
      await q.query(`UPDATE reservations SET status = '운행 중' WHERE id = $1`, [r.id]);
      return { ok: true, startOdometer };
    });
  }

  /** 주유 기록 — 운행 중·확인 대기일 때만 [유-1] [유-2] */
  @Post(':id/fuel')
  async addFuel(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const r = await loadReservation({ query, queryOne } as Q, Number(id));
    if (!isStaff(req.user.role)) mustBeDriver(req.user, r);
    if (!['운행 중', '확인 대기'].includes(r.status)) throw bad('주유 기록은 운행 중이거나 확인 대기일 때만 남길 수 있어요.');
    const trip = await queryOne<any>('SELECT id, departed_at FROM trips WHERE reservation_id = $1', [r.id]);
    if (!trip) throw bad('운행 기록이 없어요.');
    const fueledOn = body?.fueledOn ? normDate(body.fueledOn, '주유 날짜') : todayKst();
    if (fueledOn > todayKst()) throw bad('주유 날짜는 오늘 이전이어야 해요.');
    const amount = posInt(body?.amount, '금액(원)');
    const liters = Number(body?.liters);
    if (!Number.isFinite(liters) || liters <= 0) throw bad('주유량(리터)은 0보다 크게 적어 주세요.');
    const row = await queryOne<any>(
      'INSERT INTO fuel_records (trip_id, fueled_on, amount, liters) VALUES ($1, $2, $3, $4) RETURNING id',
      [trip.id, fueledOn, amount, Math.round(liters * 100) / 100],
    );
    return { id: row!.id };
  }

  /** 도착 입력 → '확인 대기' [운-1] [운-3] */
  @Post(':id/return')
  async returnCar(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return tx(async (q) => {
      const r = await loadReservation(q, Number(id), true);
      mustBeDriver(req.user, r);
      if (r.status !== '운행 중') throw bad('도착을 입력할 수 있는 상태가 아니에요.');
      const trip = await q.queryOne<any>('SELECT id, start_odometer FROM trips WHERE reservation_id = $1', [r.id]);
      if (!trip) throw bad('운행 기록이 없어요.');
      const end = Number(body?.endOdometer);
      if (!Number.isInteger(end) || end < 0) throw bad('도착 주행거리를 숫자로 적어 주세요.');
      if (end <= trip.startOdometer) throw bad(`도착 주행거리는 출발 주행거리(${trip.startOdometer.toLocaleString('ko-KR')}km)보다 커야 해요.`);
      const diff = end - trip.startOdometer;
      if (diff > WARN_KM && body?.acknowledge !== true) {
        throw bad(`너무 멀리 다녀오셨어요(${diff.toLocaleString('ko-KR')}km). 맞는지 확인해 주세요. 맞으면 한 번 더 눌러 주세요.`, {
          code: 'DISTANCE_WARNING',
          distance: diff,
        });
      }
      await q.query('UPDATE trips SET end_odometer = $1, return_entered_at = $2 WHERE id = $3', [end, nowKst(), trip.id]);
      await q.query(`UPDATE reservations SET status = '확인 대기' WHERE id = $1`, [r.id]);
      return { ok: true, distance: diff };
    });
  }

  /** 반납 확인 — 총무팀만, 자기가 운행한 예약은 확인할 수 없어요. [운-5] [운-9] */
  @Roles('staff')
  @Post(':id/confirm')
  async confirm(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return tx(async (q) => {
      const r = await loadReservation(q, Number(id), true);
      if (r.status !== '확인 대기') throw bad('반납 확인을 할 수 있는 상태가 아니에요.');
      if (r.driverId === req.user.employeeId) {
        throw forbidden('자기가 운행한 예약은 직접 확인할 수 없어요. 다른 총무팀 직원이 확인해 주세요.');
      }
      await q.query(
        'UPDATE trips SET confirmed_by = $1, confirmed_at = $2, smoking_violation = $3 WHERE reservation_id = $4',
        [req.user.id, nowKst(), body?.smokingViolation === true, r.id],
      );
      await q.query(`UPDATE reservations SET status = '반납' WHERE id = $1`, [r.id]);
      return { ok: true };
    });
  }

  /** 출발 거리 수정 — 총무팀만 [운-2] */
  @Roles('staff')
  @Patch(':id/start-odometer')
  async fixStart(@Param('id') id: string, @Body() body: any) {
    const trip = await queryOne<any>('SELECT id, end_odometer FROM trips WHERE reservation_id = $1', [Number(id)]);
    if (!trip) throw notFound('운행 기록이 없어요.');
    const n = Number(body?.startOdometer);
    if (!Number.isInteger(n) || n < 0) throw bad('출발 주행거리를 숫자로 적어 주세요.');
    if (trip.endOdometer !== null && n >= trip.endOdometer) throw bad('출발 주행거리는 도착 주행거리보다 작아야 해요.');
    await query('UPDATE trips SET start_odometer = $1 WHERE id = $2', [n, trip.id]);
    return { ok: true };
  }
}

/** 주유 기록 수정: 영수증 제출 표시는 총무팀, 값 수정은 운전자(반납 확인 전)·총무팀 [F-6] [유-4] */
@Controller('fuel-records')
export class FuelController {
  @Patch(':id')
  async patch(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const f = await queryOne<any>(
      `SELECT f.id, r.status, e.user_id AS driver_user_id
         FROM fuel_records f JOIN trips t ON t.id = f.trip_id JOIN reservations r ON r.id = t.reservation_id JOIN employees e ON e.id = r.driver_id
        WHERE f.id = $1`,
      [Number(id)],
    );
    if (!f) throw notFound('주유 기록을 찾을 수 없어요.');
    const staff = isStaff(req.user.role);
    if (body?.receiptSubmitted !== undefined) {
      if (!staff) throw forbidden('영수증 제출 표시는 총무팀만 할 수 있어요.');
      await query('UPDATE fuel_records SET receipt_submitted = $1 WHERE id = $2', [body.receiptSubmitted === true, f.id]);
    }
    if (body?.amount !== undefined || body?.liters !== undefined) {
      if (!staff && !(f.driverUserId === req.user.id && ['운행 중', '확인 대기'].includes(f.status))) {
        throw forbidden('반납 확인이 끝난 기록은 총무팀만 고칠 수 있어요.');
      }
      if (body?.amount !== undefined) await query('UPDATE fuel_records SET amount = $1 WHERE id = $2', [posInt(body.amount, '금액(원)'), f.id]);
      if (body?.liters !== undefined) {
        const l = Number(body.liters);
        if (!Number.isFinite(l) || l <= 0) throw bad('주유량(리터)은 0보다 크게 적어 주세요.');
        await query('UPDATE fuel_records SET liters = $1 WHERE id = $2', [Math.round(l * 100) / 100, f.id]);
      }
    }
    return { ok: true };
  }
}
