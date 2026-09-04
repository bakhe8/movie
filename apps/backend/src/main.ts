import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './modules/app/app.module';
import { initObservability } from './observability/observability';

async function bootstrap() {
  // Before the app: instrumentation has to patch http and pg before anything
  // requires them. Both are no-ops unless their env var is set (ALPHA_PLAN
  // 7.5), and neither can stop the boot.
  await initObservability();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // M10 (BP §21.3): behind any reverse proxy -- every staging/prod topology
  // these docs describe, even though hosting itself is undecided (ADR-24)
  // -- Express's default req.ip is the proxy's own address, not the
  // client's, so every user shares one ThrottlerGuard bucket and the
  // auth routes' 5/min brute-force limit becomes 5/min combined for
  // everyone. A hop count, not `true`: `true` trusts an arbitrary-length
  // forwarded chain, which would let a client set its own
  // X-Forwarded-For and dodge the limit entirely. 1 (a single reverse
  // proxy directly in front of the app) is correct for every topology
  // named in these docs; TRUST_PROXY_HOPS overrides it once a real one is
  // chosen. @nestjs/throttler's default tracker already reads req.ip, so
  // no custom getTracker is needed once Express resolves it correctly.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  // Matches NEXT_PUBLIC_API_URL=http://localhost:3101/api in
  // apps/frontend/.env.local -- keep both in sync.
  app.setGlobalPrefix('api');

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.API_PORT || process.env.PORT || 3101;
  await app.listen(port);
  console.log(`🚀 Backend running on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
