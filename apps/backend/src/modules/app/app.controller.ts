import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  getHello(): { message: string } {
    return this.appService.getHello();
  }

  // Railway's health check path (apps/backend/railway.json) and the smoke
  // test after every deploy. A process that answers over an empty catalog
  // is not healthy: every screen then says "no results", truthfully, and a
  // release that never seeded stays invisible until a user notices (the
  // live round of 2026-09-05 found "the whole catalog: 12"). The release
  // step seeds before the app receives traffic (ADR-90), so an empty
  // `titles` here is always a failed release, never a fresh install.
  @Get('health')
  async health(): Promise<{ status: 'ok'; catalog: { titles: number } }> {
    let titles: number;
    try {
      const rows = (await this.dataSource.query('SELECT count(*)::int AS titles FROM titles')) as { titles: number }[];
      titles = rows[0]?.titles ?? 0;
    } catch {
      throw new ServiceUnavailableException({ status: 'down', reason: 'database_unreachable' });
    }
    if (titles === 0) {
      throw new ServiceUnavailableException({ status: 'degraded', reason: 'empty_catalog', catalog: { titles: 0 } });
    }
    return { status: 'ok', catalog: { titles } };
  }
}
