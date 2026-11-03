import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/auth.js';
import { query, queryOne } from '../common/db.js';
import { bad, notFound, str } from '../common/http.js';
import { addDays, monthRange, nowKst, normDate, todayKst } from '../common/time.js';

/** 통계와 오늘 할 일 — 총무팀만. 저장하지 않고 그때그때 계산해요. */
@Roles('staff')
@Controller('stats')
export class StatsController {
  @Get('home')
  async home() {
    const now = nowKst();
    const today = todayKst();
    const one = async (sql: string, params: any[] = []) => Number((await queryOne<any>(sql, params))!.n);
    // 서로 의존하지 않는 쿼리는 한꺼번에 보내요. (DB가 멀리 있어도 한 번 왕복하는 시간만 걸려요)
    const queries = {
      confirmWaiting: one(`SELECT count(*) AS n FROM reservations WHERE status = '확인 대기'`),
      overdue: one(
        `SELECT count(*) AS n FROM reservations WHERE status = '운행 중' AND $1::timestamp > end_at + interval '30 minutes'`,
        [now],
      ),
      licensePending: one(`SELECT count(*) AS n FROM employees WHERE license_status = '승인 대기'`),
      licenseExpiring: one(
        `SELECT count(*) AS n FROM employees WHERE license_status = '승인' AND license_expiry BETWEEN $1::date AND $2::date`,
        [today, addDays(today, 30)],
      ),
      claimsPending: one(`SELECT count(*) AS n FROM personal_vehicle_claims WHERE status = '신청됨'`),
      accidentsOverdue: one(
        `SELECT count(*) AS n FROM accidents WHERE report_submitted = false AND $1::date > accident_date + 3`,
        [today],
      ),
    };
    const values = await Promise.all(Object.values(queries));
    return Object.fromEntries(Object.keys(queries).map((k, i) => [k, values[i]]));
  }

  /** 차량별 이번 달 운행 거리·주유비·1km당 주유비 [집-1] [집-2] [집-3] */
  @Get('vehicles-monthly')
  async vehiclesMonthly(@Query('month') month?: string) {
    const m = monthRange(month);
    const rows = await query<any>(
      `SELECT v.id AS vehicle_id, v.model, v.plate_no,
         (SELECT count(*) FROM reservations r WHERE r.vehicle_id = v.id AND r.status = '반납'
             AND r.start_at >= $1::date AND r.start_at < $2::date) AS trip_count,
         COALESCE((SELECT sum(t.end_odometer - t.start_odometer) FROM trips t JOIN reservations r ON r.id = t.reservation_id
             WHERE r.vehicle_id = v.id AND r.status = '반납' AND r.start_at >= $1::date AND r.start_at < $2::date), 0) AS distance_km,
         COALESCE((SELECT sum(f.amount) FROM fuel_records f JOIN trips t ON t.id = f.trip_id JOIN reservations r ON r.id = t.reservation_id
             WHERE r.vehicle_id = v.id AND f.fueled_on >= $1::date AND f.fueled_on < $2::date), 0) AS fuel_amount,
         COALESCE((SELECT sum(f.liters) FROM fuel_records f JOIN trips t ON t.id = f.trip_id JOIN reservations r ON r.id = t.reservation_id
             WHERE r.vehicle_id = v.id AND f.fueled_on >= $1::date AND f.fueled_on < $2::date), 0) AS fuel_liters
         FROM vehicles v ORDER BY v.id`,
      [m.from, m.to],
    );
    const items = rows.map((r) => ({
      ...r,
      distanceKm: Number(r.distanceKm),
      fuelAmount: Number(r.fuelAmount),
      costPerKm: Number(r.distanceKm) > 0 ? Math.round((Number(r.fuelAmount) / Number(r.distanceKm)) * 10) / 10 : null,
    }));
    return { month: m.month, items };
  }

  /** 부서별 이번 달 이용 횟수·운행 거리 — 반납 완료된 예약만, 예약 당시 부서 기준 [집-4] */
  @Get('departments-monthly')
  async departmentsMonthly(@Query('month') month?: string) {
    const m = monthRange(month);
    const items = await query<any>(
      `SELECT d.id AS department_id, d.name AS department_name,
              count(r.id) AS use_count,
              COALESCE(sum(t.end_odometer - t.start_odometer), 0) AS distance_km
         FROM departments d
         LEFT JOIN reservations r ON r.department_id = d.id AND r.status = '반납'
              AND r.start_at >= $1::date AND r.start_at < $2::date
         LEFT JOIN trips t ON t.reservation_id = r.id
        GROUP BY d.id, d.name ORDER BY d.id`,
      [m.from, m.to],
    );
    return { month: m.month, items: items.map((r) => ({ ...r, distanceKm: Number(r.distanceKm) })) };
  }
}

/** 사고 기록 — 총무팀만 [사-1] */
@Roles('staff')
@Controller('accidents')
export class AccidentsController {
  @Get()
  async list() {
    const today = todayKst();
    const rows = await query<any>(
      `SELECT a.id, a.accident_date, a.description, a.report_submitted, a.created_by,
              r.id AS reservation_id, v.model, v.plate_no, e.name AS driver_name,
              ($1::date > a.accident_date + 3 AND a.report_submitted = false) AS report_overdue
         FROM accidents a JOIN trips t ON t.id = a.trip_id JOIN reservations r ON r.id = t.reservation_id
         JOIN vehicles v ON v.id = r.vehicle_id JOIN employees e ON e.id = r.driver_id
        ORDER BY a.accident_date DESC, a.id DESC`,
      [today],
    );
    return { items: rows, total: rows.length };
  }

  /** 사고를 연결할 수 있는 예약(출발해서 운행 기록이 있는 것) */
  @Get('reservations')
  reservations() {
    return query(
      `SELECT r.id, r.start_at, r.status, v.model, v.plate_no, e.name AS driver_name
         FROM reservations r JOIN trips t ON t.reservation_id = r.id JOIN vehicles v ON v.id = r.vehicle_id
         JOIN employees e ON e.id = r.driver_id ORDER BY r.start_at DESC LIMIT 100`,
    );
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const reservationId = Number(body?.reservationId);
    const trip = await queryOne<any>('SELECT id FROM trips WHERE reservation_id = $1', [reservationId]);
    if (!trip) throw bad('출발해서 운행 기록이 있는 예약에만 사고를 기록할 수 있어요.');
    const accidentDate = normDate(body?.accidentDate, '사고 날짜');
    if (accidentDate > todayKst()) throw bad('사고 날짜는 오늘 이전이어야 해요.');
    const description = str(body?.description, '사고 내용', { max: 500 });
    const row = await queryOne<any>(
      `INSERT INTO accidents (trip_id, accident_date, description, report_submitted, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [trip.id, accidentDate, description, body?.reportSubmitted === true, req.user.id],
    );
    return { id: row!.id };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const a = await queryOne<any>('SELECT id FROM accidents WHERE id = $1', [Number(id)]);
    if (!a) throw notFound('사고 기록을 찾을 수 없어요.');
    if (body?.description !== undefined) {
      await query('UPDATE accidents SET description = $1 WHERE id = $2', [str(body.description, '사고 내용', { max: 500 }), a.id]);
    }
    if (body?.reportSubmitted !== undefined) {
      await query('UPDATE accidents SET report_submitted = $1 WHERE id = $2', [body.reportSubmitted === true, a.id]);
    }
    return { ok: true };
  }
}
