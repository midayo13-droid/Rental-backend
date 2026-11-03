import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { isStaff, Roles } from '../auth/auth.js';
import { query, queryOne } from '../common/db.js';
import { bad, conflict, forbidden, notFound, pageParams, pageResult, posInt, str } from '../common/http.js';
import { addDays, monthRange, nowKst, normDate, todayKst } from '../common/time.js';

const RATE_PER_KM = 200; // 개인 차량 1km당 정산 단가 [K-2]
const WINDOW_DAYS = 30; // 이용일로부터 신청 기한 [K-5]
const WARN_KM = 1000; // 한 건 거리 경고 [K-7]

const SELECT = `
  SELECT c.id, c.employee_id, e.name AS employee_name, c.department_id, d.name AS department_name,
         c.travel_date, c.destination, c.distance_km, c.rate_per_km, (c.distance_km * c.rate_per_km) AS amount,
         (c.distance_km > ${WARN_KM}) AS distance_warning,
         c.status, c.decided_at, c.reject_reason, c.canceled_at, c.created_at
    FROM personal_vehicle_claims c
    JOIN employees e ON e.id = c.employee_id
    JOIN departments d ON d.id = c.department_id`;

/** 개인 차량 정산 (1km당 200원) [개-1]~[개-10] */
@Controller('claims')
export class ClaimsController {
  @Get('monthly')
  @Roles('staff')
  async monthly(@Query('month') month?: string) {
    const m = monthRange(month);
    const byEmployee = await query(
      `SELECT e.id AS employee_id, e.name, d.name AS department_name, count(*) AS claim_count,
              sum(c.distance_km) AS distance_km, sum(c.distance_km * c.rate_per_km) AS amount
         FROM personal_vehicle_claims c JOIN employees e ON e.id = c.employee_id JOIN departments d ON d.id = e.department_id
        WHERE c.status = '승인됨' AND c.travel_date >= $1::date AND c.travel_date < $2::date
        GROUP BY e.id, e.name, d.name ORDER BY amount DESC`,
      [m.from, m.to],
    );
    const byDepartment = await query(
      `SELECT d.id AS department_id, d.name AS department_name, count(c.id) AS claim_count,
              COALESCE(sum(c.distance_km), 0) AS distance_km, COALESCE(sum(c.distance_km * c.rate_per_km), 0) AS amount
         FROM departments d
         LEFT JOIN personal_vehicle_claims c ON c.department_id = d.id AND c.status = '승인됨'
              AND c.travel_date >= $1::date AND c.travel_date < $2::date
        GROUP BY d.id, d.name ORDER BY d.id`,
      [m.from, m.to],
    );
    const total = (byEmployee as any[]).reduce((s, r) => s + Number(r.amount), 0);
    return { month: m.month, total, byEmployee, byDepartment };
  }

  @Get()
  async list(@Req() req: any, @Query() q: any) {
    const staff = isStaff(req.user.role);
    const p = pageParams(q);
    const params: any[] = [];
    const where: string[] = [];
    if (!staff || q?.mine === '1') {
      params.push(req.user.employeeId ?? 0);
      where.push(`c.employee_id = $${params.length}`);
    }
    if (q?.status) {
      params.push(String(q.status));
      where.push(`c.status = $${params.length}`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await queryOne<any>(`SELECT count(*) AS n FROM personal_vehicle_claims c ${w}`, params))!.n;
    const limit = p.paged ? `LIMIT ${p.size} OFFSET ${p.offset}` : 'LIMIT 1000';
    const items = await query(`${SELECT} ${w} ORDER BY c.created_at DESC, c.id DESC ${limit}`, params);
    return pageResult(items, total, p);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    if (!req.user.employeeId) throw bad('직원 명부에 연결된 계정이 아니에요.');
    const travelDate = normDate(body?.travelDate, '이용일');
    const destination = str(body?.destination, '목적지', { max: 100 });
    const distanceKm = posInt(body?.distanceKm, '왕복 거리(km)'); // [개-4]
    const today = todayKst();
    if (travelDate > today) throw bad('이용일은 오늘 이전이어야 해요. 다녀온 뒤에 신청해 주세요.'); // [개-5]
    if (travelDate < addDays(today, -WINDOW_DAYS)) throw bad(`이용일로부터 ${WINDOW_DAYS}일이 지나서 신청할 수 없어요. 총무팀에 문의해 주세요.`);
    if (distanceKm > WARN_KM && body?.acknowledge !== true) {
      throw bad(`거리가 ${distanceKm.toLocaleString('ko-KR')}km예요. 너무 멀어요. 맞는지 확인해 주세요. 맞으면 한 번 더 눌러 주세요.`, {
        code: 'DISTANCE_WARNING',
      }); // [개-7]
    }
    if (
      await queryOne(
        `SELECT 1 FROM personal_vehicle_claims WHERE employee_id = $1 AND travel_date = $2 AND status IN ('신청됨', '승인됨')`,
        [req.user.employeeId, travelDate],
      )
    ) {
      throw conflict('그날은 이미 개인 차량 정산을 신청하셨어요.'); // [개-6]
    }
    const row = await queryOne<any>(
      `INSERT INTO personal_vehicle_claims (employee_id, department_id, travel_date, destination, distance_km, rate_per_km)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.employeeId, req.user.departmentId, travelDate, destination, distanceKm, RATE_PER_KM],
    );
    return { id: row!.id, amount: distanceKm * RATE_PER_KM };
  }

  @Post(':id/cancel')
  async cancel(@Req() req: any, @Param('id') id: string) {
    const c = await queryOne<any>('SELECT id, employee_id, status FROM personal_vehicle_claims WHERE id = $1', [Number(id)]);
    if (!c) throw notFound('정산 신청을 찾을 수 없어요.');
    if (c.employeeId !== req.user.employeeId) throw forbidden('내 정산만 취소할 수 있어요.');
    if (c.status !== '신청됨') throw bad('승인 전인 신청만 취소할 수 있어요.'); // [개-9]
    await query(`UPDATE personal_vehicle_claims SET status = '취소', canceled_at = $1 WHERE id = $2`, [nowKst(), c.id]);
    return { ok: true };
  }

  @Roles('staff')
  @Post(':id/approve')
  async approve(@Req() req: any, @Param('id') id: string) {
    const c = await this.decidable(req, id);
    await query(`UPDATE personal_vehicle_claims SET status = '승인됨', decided_by = $1, decided_at = $2 WHERE id = $3`, [
      req.user.id, nowKst(), c.id,
    ]);
    return { ok: true };
  }

  @Roles('staff')
  @Post(':id/reject')
  async reject(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const reason = str(body?.reason, '반려 사유', { max: 200 });
    const c = await this.decidable(req, id);
    await query(
      `UPDATE personal_vehicle_claims SET status = '반려됨', decided_by = $1, decided_at = $2, reject_reason = $3 WHERE id = $4`,
      [req.user.id, nowKst(), reason, c.id],
    );
    return { ok: true };
  }

  /** 승인·반려 공통 검사 — 자기 신청은 자기가 처리할 수 없어요. [개-8] */
  private async decidable(req: any, id: string) {
    const c = await queryOne<any>('SELECT id, employee_id, status FROM personal_vehicle_claims WHERE id = $1', [Number(id)]);
    if (!c) throw notFound('정산 신청을 찾을 수 없어요.');
    if (c.employeeId === req.user.employeeId) throw forbidden('자기 정산은 직접 승인·반려할 수 없어요. 다른 총무팀 직원이 처리해 주세요.');
    if (c.status !== '신청됨') throw bad('이미 처리된 신청이에요.');
    return c;
  }
}
