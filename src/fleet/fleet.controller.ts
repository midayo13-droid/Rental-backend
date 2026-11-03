import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/auth.js';
import { query, queryOne, tx } from '../common/db.js';
import { bad, conflict, notFound, posInt, str } from '../common/http.js';
import { humanDate, normDate } from '../common/time.js';

@Controller()
export class FleetController {
  @Get('vehicles')
  vehicles() {
    return query('SELECT id, model, plate_no, seat_count, initial_odometer FROM vehicles ORDER BY id');
  }

  @Roles('staff')
  @Patch('vehicles/:id')
  async updateVehicle(@Param('id') id: string, @Body() body: any) {
    const v = await queryOne<any>('SELECT * FROM vehicles WHERE id = $1', [Number(id)]);
    if (!v) throw notFound('차량을 찾을 수 없어요.');
    const model = body?.model !== undefined ? str(body.model, '차종', { max: 50 }) : v.model;
    const plateNo = body?.plateNo !== undefined ? str(body.plateNo, '차량번호', { max: 20 }) : v.plateNo;
    const seatCount = body?.seatCount !== undefined ? posInt(body.seatCount, '좌석 수') : v.seatCount;
    if (plateNo !== v.plateNo && (await queryOne('SELECT 1 FROM vehicles WHERE plate_no = $1', [plateNo]))) {
      throw conflict('이미 등록된 차량번호예요.');
    }
    await query('UPDATE vehicles SET model = $1, plate_no = $2, seat_count = $3 WHERE id = $4', [
      model, plateNo, seatCount, v.id,
    ]);
    return { ok: true };
  }

  @Roles('staff')
  @Get('maintenance')
  maintenance() {
    return query(
      `SELECT m.id, m.vehicle_id, v.model, v.plate_no, m.start_date, m.end_date, m.reason
         FROM maintenance_schedules m JOIN vehicles v ON v.id = m.vehicle_id
        ORDER BY m.start_date DESC, m.id DESC`,
    );
  }

  /** 점검 등록 — 이미 예약이 있는 기간에는 등록할 수 없어요. [점-1] [Q8] */
  @Roles('staff')
  @Post('maintenance')
  async createMaintenance(@Body() body: any) {
    const vehicleId = posInt(body?.vehicleId, '차량');
    const startDate = normDate(body?.startDate, '시작일');
    const endDate = normDate(body?.endDate, '끝일');
    const reason = str(body?.reason, '사유', { max: 200 });
    if (endDate < startDate) throw bad('끝일은 시작일보다 같거나 늦어야 해요.');

    return tx(async (q) => {
      const v = await q.queryOne('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
      if (!v) throw notFound('차량을 찾을 수 없어요.');
      const clash = await q.query<any>(
        `SELECT r.id, r.start_at, r.end_at, e.name AS driver_name
           FROM reservations r JOIN employees e ON e.id = r.driver_id
          WHERE r.vehicle_id = $1 AND r.status <> '취소'
            AND r.start_at::date <= $3::date AND r.end_at::date >= $2::date
          ORDER BY r.start_at`,
        [vehicleId, startDate, endDate],
      );
      if (clash.length > 0) {
        throw conflict(
          `그 기간(${humanDate(startDate)}~${humanDate(endDate)})에 예약이 ${clash.length}건 있어요. 예약을 먼저 정리(취소)한 뒤 점검을 등록해 주세요.`,
          { reservations: clash },
        );
      }
      const overlap = await q.queryOne(
        `SELECT 1 FROM maintenance_schedules
          WHERE vehicle_id = $1 AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`,
        [vehicleId, startDate, endDate],
      );
      if (overlap) throw conflict('그 기간에는 이미 점검 일정이 있어요.');
      const row = await q.queryOne<any>(
        `INSERT INTO maintenance_schedules (vehicle_id, start_date, end_date, reason)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [vehicleId, startDate, endDate, reason],
      );
      return { id: row!.id };
    });
  }

  @Roles('admin')
  @Delete('maintenance/:id')
  async deleteMaintenance(@Param('id') id: string) {
    await query('DELETE FROM maintenance_schedules WHERE id = $1', [Number(id)]);
    return { ok: true };
  }
}
