import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsController } from './accounts/accounts.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard, Public } from './auth/auth.js';
import { ChatController } from './chat/chat.controller.js';
import { ClaimsController } from './claims/claims.controller.js';
import { DemoController } from './demo/demo.controller.js';
import { FleetController } from './fleet/fleet.controller.js';
import { PeopleController } from './people/people.controller.js';
import { FuelController, ReservationsController } from './reservations/reservations.controller.js';
import { AccidentsController, StatsController } from './stats/stats.controller.js';

@Controller()
class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true, name: '누리상사 법인차량 백엔드' };
  }
}

@Module({
  controllers: [
    HealthController,
    AuthController,
    PeopleController,
    FleetController,
    ReservationsController,
    FuelController,
    ClaimsController,
    AccidentsController,
    StatsController,
    AccountsController,
    ChatController,
    DemoController,
  ],
  // 모든 주소에서 로그인과 역할을 서버가 확인해요. (/health 와 가입·로그인만 예외)
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
