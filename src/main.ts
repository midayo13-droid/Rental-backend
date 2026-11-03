import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { FriendlyErrorFilter } from './common/http.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalFilters(new FriendlyErrorFilter());

  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : true });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`서버가 켜졌어요: http://localhost:${port}  (확인: /health)`);
}
await bootstrap();
