import { Controller, Post } from '@nestjs/common';
import { Roles } from '../auth/auth.js';
import { tx } from '../common/db.js';
import { forbidden } from '../common/http.js';
import { DEMO_COUNTS, seedActivity } from './demo-data.js';

/** 가상 데이터 다시 채우기 — 관리자만. 로그인 계정과 직원 명부는 그대로 두고 활동 데이터만 처음 상태로 되돌려요. */
@Roles('admin')
@Controller('admin')
export class DemoController {
  @Post('reset-demo')
  async resetDemo() {
    // 배포한 뒤 실수로 지우지 않도록 환경변수로 끌 수 있어요. (DEMO_RESET_ENABLED=false)
    if (process.env.DEMO_RESET_ENABLED === 'false') {
      throw forbidden('이 서버에서는 가상 데이터 다시 채우기를 쓸 수 없어요.');
    }
    await tx(async (q) => {
      // hw2 안의 활동 테이블만 비워요. (계정·직원 명부·부서·차량은 건드리지 않아요)
      await q.query(
        `TRUNCATE accidents, fuel_records, trips, reservation_companions, reservations, maintenance_schedules, personal_vehicle_claims RESTART IDENTITY`,
      );
      await seedActivity(async (sql, params) => q.query(sql, params));
    });
    return { ok: true, reservations: DEMO_COUNTS.reservations, claims: DEMO_COUNTS.claims };
  }
}
