import { describe, expect, it, vi } from 'vitest';
import { AdminMetricsService, metricsRate } from './admin-metrics.service';

describe('AdminMetricsService', () => {
  it('rates are null on an empty denominator and rounded otherwise', () => {
    expect(metricsRate(1, 0)).toBeNull();
    expect(metricsRate(1, 3)).toBe(0.3333);
    expect(metricsRate(0, 5)).toBe(0);
  });

  it('assembles a report from empty tables without NaN or undefined', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('generate_series')) return [];
      if (sql.includes('GROUP BY 1')) return [];
      return [{}];
    });
    const service = new AdminMetricsService({ query } as never);
    const report = await service.report({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-04T00:00:00Z'), excludeDomains: ['demo.local'] });
    expect(report.window).toMatchObject({ days: 3, excludeDomains: ['demo.local'] });
    expect(report.funnel.steps.map((s) => s.step)).toEqual([
      'registered',
      'onboarded',
      'watched_3',
      'first_triad',
      'three_triads',
      'trained',
      'shown_result',
      'returned',
    ]);
    expect(report.funnel.steps[1].rate).toBeNull();
    expect(report.recommendations.outcomes).toEqual({ clicked: 0, saved: 0, opened_provider: 0, dismissed_not_relevant: 0, watched: 0, ranked_later: 0 });
    expect(report.recommendations.rates.clickThrough).toBeNull();
    expect(report.triads.answerSeconds.median).toBeNull();
    expect(JSON.stringify(report)).not.toContain('NaN');
    // Every query received the same three parameters: from, to, domains.
    for (const call of query.mock.calls) {
      const params = call[1] as unknown[] | undefined;
      if (params && params.length === 3) {
        expect(params[2]).toEqual(['demo.local']);
      }
    }
  });

  it('separates click, watch and later ranking and never sums them', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM outcomes o') && sql.includes('o.type AS key')) {
        return [
          { key: 'clicked', count: '4' },
          { key: 'watched', count: '2' },
          { key: 'ranked_later', count: '1' },
        ];
      }
      if (sql.includes('COUNT(*) AS shown')) return [{ shown: '10', requests: '3', profiles: '2' }];
      if (sql.includes('generate_series') || sql.includes('GROUP BY 1')) return [];
      return [{}];
    });
    const service = new AdminMetricsService({ query } as never);
    const report = await service.report({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z'), excludeDomains: [] });
    expect(report.recommendations.shown).toBe(10);
    expect(report.recommendations.outcomes).toMatchObject({ clicked: 4, watched: 2, ranked_later: 1 });
    expect(report.recommendations.rates).toEqual({ clickThrough: 0.4, watched: 0.2, rankedLater: 0.1, dismissed: 0 });
  });
});
