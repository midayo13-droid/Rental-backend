import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { isStaff, Roles } from '../auth/auth.js';
import { query, queryOne } from '../common/db.js';
import { bad, forbidden, notFound, pageParams, pageResult } from '../common/http.js';
import { addDays, normDate, todayKst } from '../common/time.js';

@Controller()
export class PeopleController {
  @Get('departments')
  departments() {
    return query('SELECT id, name FROM departments ORDER BY id');
  }

  /** 직원 명부. 총무팀은 전체 정보, 고객은 동승자 선택용(이름·부서)만 보여요. */
  @Get('employees')
  async employees(@Req() req: any, @Query() q: any) {
    const staff = isStaff(req.user.role);
    const p = pageParams(q);
    const where: string[] = [];
    const params: any[] = [];
    if (q?.q) {
      params.push(`%${String(q.q).trim()}%`);
      where.push(`(e.name ILIKE $${params.length} OR e.employee_no ILIKE $${params.length})`);
    }
    if (q?.departmentId) {
      params.push(Number(q.departmentId));
      where.push(`e.department_id = $${params.length}`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await queryOne<any>(`SELECT count(*) AS n FROM employees e ${w}`, params))!.n;
    const limit = p.paged ? `LIMIT ${p.size} OFFSET ${p.offset}` : 'LIMIT 1000';
    const rows = await query<any>(
      `SELECT e.id, e.employee_no, e.name, e.department_id, d.name AS department_name,
              e.license_status, e.license_expiry, (e.user_id IS NOT NULL) AS has_account, u.role
         FROM employees e JOIN departments d ON d.id = e.department_id LEFT JOIN users u ON u.id = e.user_id
         ${w} ORDER BY d.id, e.name ${limit}`,
      params,
    );
    const items = staff
      ? rows
      : rows.map((r) => ({ id: r.id, name: r.name, departmentName: r.departmentName }));
    return pageResult(items, total, p);
  }

  /** 면허 만료일 입력(본인) → '승인 대기' [면-1] [면-4] */
  @Patch('employees/me/license')
  async setLicense(@Req() req: any, @Body() body: any) {
    if (!req.user.employeeId) throw bad('직원 명부에 연결된 계정이 아니에요.');
    const expiry = normDate(body?.expiry, '면허 만료일');
    await query(`UPDATE employees SET license_expiry = $1, license_status = '승인 대기' WHERE id = $2`, [
      expiry,
      req.user.employeeId,
    ]);
    return { ok: true, licenseStatus: '승인 대기', licenseExpiry: expiry };
  }

  @Roles('staff')
  @Get('employees/license-pending')
  pending() {
    return query(
      `SELECT e.id, e.employee_no, e.name, d.name AS department_name, e.license_expiry
         FROM employees e JOIN departments d ON d.id = e.department_id
        WHERE e.license_status = '승인 대기' ORDER BY e.name`,
    );
  }

  /** 면허 승인 — 자기 면허는 자기가 승인할 수 없어요. [L-6] */
  @Roles('staff')
  @Post('employees/:id/license/approve')
  async approve(@Req() req: any, @Param('id') id: string) {
    const target = await queryOne<any>('SELECT id, license_status FROM employees WHERE id = $1', [Number(id)]);
    if (!target) throw notFound('직원을 찾을 수 없어요.');
    if (target.id === req.user.employeeId) {
      throw forbidden('자기 면허는 직접 승인할 수 없어요. 다른 총무팀 직원이 승인해 주세요.');
    }
    if (target.licenseStatus !== '승인 대기') throw bad('승인 대기 중인 면허가 아니에요.');
    await query(`UPDATE employees SET license_status = '승인' WHERE id = $1`, [target.id]);
    return { ok: true };
  }

  /** 면허 만료 30일 이내 직원 + 예약 후 만료돼 버린 예약 [L-3] [L-4] */
  @Roles('staff')
  @Get('employees/license-expiring')
  async expiring() {
    const today = todayKst();
    const expiring = await query(
      `SELECT e.id, e.employee_no, e.name, d.name AS department_name, e.license_expiry,
              (e.license_expiry - $1::date) AS days_left
         FROM employees e JOIN departments d ON d.id = e.department_id
        WHERE e.license_status = '승인' AND e.license_expiry BETWEEN $1::date AND $2::date
        ORDER BY e.license_expiry`,
      [today, addDays(today, 30)],
    );
    const affected = await query(
      `SELECT r.id, r.start_at, r.end_at, r.status, v.model, v.plate_no, e.name AS driver_name, e.license_expiry
         FROM reservations r
         JOIN employees e ON e.id = r.driver_id JOIN vehicles v ON v.id = r.vehicle_id
        WHERE r.status IN ('예약됨', '운행 중') AND e.license_expiry IS NOT NULL AND r.end_at::date > e.license_expiry
        ORDER BY r.start_at`,
    );
    return { expiring, expiredReservations: affected };
  }
}
