import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import type { AppService } from './app.service';

function controller(query: () => Promise<unknown>) {
  return new AppController({ getHello: () => ({ message: 'hi' }) } as AppService, { query } as unknown as DataSource);
}

// The health check is the one place a failed release becomes visible
// before a user does (live round 2026-09-05: "the whole catalog: 12").
describe('AppController.health', () => {
  it('answers ok with the catalog size when titles exist', async () => {
    await expect(controller(async () => [{ titles: 300 }]).health()).resolves.toEqual({
      status: 'ok',
      catalog: { titles: 300 },
    });
  });

  it('answers 503 degraded, with the reason, over an empty catalog', async () => {
    const promise = controller(async () => [{ titles: 0 }]).health();
    await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(promise).rejects.toMatchObject({ response: { status: 'degraded', reason: 'empty_catalog' } });
  });

  it('answers 503 down when the database does not answer', async () => {
    const promise = controller(async () => {
      throw new Error('connection refused');
    }).health();
    await expect(promise).rejects.toMatchObject({ response: { status: 'down', reason: 'database_unreachable' } });
  });
});
