import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface MetricsWindow {
  from: Date;
  to: Date;
  // Accounts whose email ends with one of these are left out of every
  // number (demo personas, judge accounts). Empty = count everything.
  excludeDomains: string[];
}

export interface FunnelStep {
  step: string;
  count: number;
  // Share of the previous step; 1 for the first.
  rate: number | null;
}

export interface MetricsReport {
  window: { from: string; to: string; days: number; excludeDomains: string[] };
  accounts: { usersTotal: number; usersActive: number; registeredInWindow: number; profilesTotal: number };
  funnel: { cohort: 'registered_in_window'; size: number; steps: FunnelStep[] };
  triads: {
    completed: number;
    skipped: number;
    active: number;
    replacements: number;
    replacementRate: number | null;
    answerSeconds: { samples: number; median: number | null; p90: number | null; mean: number | null };
    byPolicy: Record<string, number>;
  };
  recommendations: {
    shown: number;
    requests: number;
    profiles: number;
    byTrack: Record<string, number>;
    byBand: Record<string, number>;
    // BP §18.1: click, watch and later ranking are separate columns, never
    // summed into one "engagement" number.
    outcomes: Record<string, number>;
    rates: { clickThrough: number | null; watched: number | null; rankedLater: number | null; dismissed: number | null };
    rankedLaterPositions: Record<string, number>;
    hoursToWatch: { samples: number; median: number | null };
  };
  model: {
    snapshotsInWindow: number;
    profilesWithSnapshot: number;
    byModelVersion: Record<string, number>;
    latestSnapshotByEvidence: Record<string, number>;
    meanHeldOutPairwiseAccuracy: number | null;
  };
  catalog: { titles: number; withFingerprint: number; withV2: number; withKnownLicense: number; unreviewedFeatures: number };
  privacy: { requestsByType: Record<string, number>; pendingDeletes: number; auditRowsInWindow: number };
  daily: Array<{ day: string; registrations: number; triadsCompleted: number; recommendationsShown: number; watchedOutcomes: number }>;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toMap(rows: Array<{ key: string | null; count: string }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.key ?? 'null', Number(row.count)]));
}

// The metrics board (BP §18.1 "the metrics board distinguishes click, watch
// and later ranking"; ARCHITECTURE.md §8 product funnel; ALPHA_PLAN phase
// 4, item 4.3). Read-only SQL over the event tables; nothing is
// pre-aggregated, so every number is reproducible from the rows.
//
// Scope: a profile is "in scope" when its account's email is not in an
// excluded domain. Every profile-based query goes through that CTE so the
// demo personas can be kept out of Alpha numbers with one parameter.
@Injectable()
export class AdminMetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async report(window: MetricsWindow): Promise<MetricsReport> {
    const params = [window.from, window.to, window.excludeDomains];
    const [accounts, funnel, triads, answer, policy, replacements, recs, track, band, outcomes, positions, watchLag, model, evidence, versions, catalog, privacy, daily] =
      await Promise.all([
        this.accounts(params),
        this.funnel(params),
        this.triadCounts(params),
        this.answerSeconds(params),
        this.groupBy(params, this.scoped(`SELECT t."policyVersion" AS key, COUNT(*) AS count FROM triads t JOIN scope s ON s.id = t."profileId" WHERE t.status = 'completed' AND COALESCE(t."answeredAt", t."createdAt") >= $1 AND COALESCE(t."answeredAt", t."createdAt") < $2 GROUP BY 1`)),
        this.scalar(params, this.scoped(`SELECT COUNT(*) AS n FROM triad_replacements r JOIN triads t ON t.id = r."triadId" JOIN scope s ON s.id = t."profileId" WHERE r."createdAt" >= $1 AND r."createdAt" < $2`)),
        this.recommendationCounts(params),
        this.groupBy(params, this.scoped(`SELECT r.track AS key, COUNT(*) AS count FROM recommendations r JOIN scope s ON s.id = r."profileId" WHERE COALESCE(r."shownAt", r."createdAt") >= $1 AND COALESCE(r."shownAt", r."createdAt") < $2 GROUP BY 1`)),
        this.groupBy(params, this.scoped(`SELECT r."confidenceBand" AS key, COUNT(*) AS count FROM recommendations r JOIN scope s ON s.id = r."profileId" WHERE COALESCE(r."shownAt", r."createdAt") >= $1 AND COALESCE(r."shownAt", r."createdAt") < $2 GROUP BY 1`)),
        this.groupBy(params, this.scoped(`SELECT o.type AS key, COUNT(*) AS count FROM outcomes o JOIN recommendations r ON r.id = o."recommendationId" JOIN scope s ON s.id = r."profileId" WHERE o."occurredAt" >= $1 AND o."occurredAt" < $2 GROUP BY 1`)),
        this.groupBy(params, this.scoped(`SELECT o."rankPosition"::text AS key, COUNT(*) AS count FROM outcomes o JOIN recommendations r ON r.id = o."recommendationId" JOIN scope s ON s.id = r."profileId" WHERE o.type = 'ranked_later' AND o."occurredAt" >= $1 AND o."occurredAt" < $2 GROUP BY 1`)),
        this.watchLag(params),
        this.modelCounts(params),
        this.groupBy(params, this.scoped(`SELECT CASE WHEN m."trainingTriadCount" < 5 THEN 'lt5' WHEN m."trainingTriadCount" < 10 THEN '5-9' WHEN m."trainingTriadCount" < 20 THEN '10-19' ELSE '20+' END AS key, COUNT(*) AS count FROM (SELECT DISTINCT ON ("profileId") * FROM user_model_snapshots ORDER BY "profileId", "createdAt" DESC) m JOIN scope s ON s.id = m."profileId" GROUP BY 1`)),
        this.groupBy(params, this.scoped(`SELECT m."modelVersion" AS key, COUNT(*) AS count FROM user_model_snapshots m JOIN scope s ON s.id = m."profileId" WHERE m."createdAt" >= $1 AND m."createdAt" < $2 GROUP BY 1`)),
        this.catalog(),
        this.privacy(params),
        this.daily(params),
      ]);

    const shown = num(recs.shown);
    const outcomeCounts = toMap(outcomes);
    const completed = num(triads.completed);
    const replacementCount = num(replacements);

    return {
      window: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        days: Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000),
        excludeDomains: window.excludeDomains,
      },
      accounts: {
        usersTotal: num(accounts.users_total),
        usersActive: num(accounts.users_active),
        registeredInWindow: num(accounts.registered),
        profilesTotal: num(accounts.profiles_total),
      },
      funnel: { cohort: 'registered_in_window', size: num(funnel.registered), steps: this.funnelSteps(funnel) },
      triads: {
        completed,
        skipped: num(triads.skipped),
        active: num(triads.active),
        replacements: replacementCount,
        replacementRate: rate(replacementCount, completed),
        answerSeconds: {
          samples: num(answer.samples),
          median: numOrNull(answer.median),
          p90: numOrNull(answer.p90),
          mean: numOrNull(answer.mean),
        },
        byPolicy: toMap(policy),
      },
      recommendations: {
        shown,
        requests: num(recs.requests),
        profiles: num(recs.profiles),
        byTrack: toMap(track),
        byBand: toMap(band),
        outcomes: {
          clicked: outcomeCounts.clicked ?? 0,
          saved: outcomeCounts.saved ?? 0,
          opened_provider: outcomeCounts.opened_provider ?? 0,
          dismissed_not_relevant: outcomeCounts.dismissed_not_relevant ?? 0,
          watched: outcomeCounts.watched ?? 0,
          ranked_later: outcomeCounts.ranked_later ?? 0,
        },
        rates: {
          clickThrough: rate(outcomeCounts.clicked ?? 0, shown),
          watched: rate(outcomeCounts.watched ?? 0, shown),
          rankedLater: rate(outcomeCounts.ranked_later ?? 0, shown),
          dismissed: rate(outcomeCounts.dismissed_not_relevant ?? 0, shown),
        },
        rankedLaterPositions: toMap(positions),
        hoursToWatch: { samples: num(watchLag.samples), median: numOrNull(watchLag.median) },
      },
      model: {
        snapshotsInWindow: num(model.snapshots),
        profilesWithSnapshot: num(model.profiles),
        byModelVersion: toMap(versions),
        latestSnapshotByEvidence: toMap(evidence),
        meanHeldOutPairwiseAccuracy: numOrNull(model.mean_acc),
      },
      catalog: {
        titles: num(catalog.titles),
        withFingerprint: num(catalog.with_fingerprint),
        withV2: num(catalog.with_v2),
        withKnownLicense: num(catalog.with_license),
        unreviewedFeatures: num(catalog.unreviewed),
      },
      privacy: {
        requestsByType: toMap(privacy.byType),
        pendingDeletes: num(privacy.pending),
        auditRowsInWindow: num(privacy.audit),
      },
      daily: daily.map((row) => ({
        day: row.day,
        registrations: num(row.registrations),
        triadsCompleted: num(row.triads),
        recommendationsShown: num(row.shown),
        watchedOutcomes: num(row.watched),
      })),
    };
  }

  // Common prefix: the in-scope users and profiles. $3 is text[] of
  // excluded domains ('{}' = none).
  private scoped(sql: string): string {
    // The metrics_window CTE ("window" is reserved) references $1/$2 with an explicit type so a query that
    // only needs $3 still lets Postgres type every parameter.
    return `WITH metrics_window AS (
      SELECT $1::timestamp AS w_from, $2::timestamp AS w_to
    ), users_in_scope AS (
      SELECT u.* FROM users u WHERE NOT EXISTS (SELECT 1 FROM unnest($3::text[]) d WHERE u.email ILIKE '%@' || d)
    ), scope AS (
      SELECT p.id, p."userId" FROM profiles p JOIN users_in_scope u ON u.id = p."userId"
    ) ${sql}`;
  }

  private async scalar(params: unknown[], sql: string): Promise<unknown> {
    const rows = (await this.dataSource.query(sql, params)) as Array<Record<string, unknown>>;
    return rows[0]?.n ?? 0;
  }

  private async one(params: unknown[], sql: string): Promise<Record<string, unknown>> {
    const rows = (await this.dataSource.query(sql, params)) as Array<Record<string, unknown>>;
    return rows[0] ?? {};
  }

  private async groupBy(params: unknown[], sql: string): Promise<Array<{ key: string | null; count: string }>> {
    return (await this.dataSource.query(sql, params)) as Array<{ key: string | null; count: string }>;
  }

  private accounts(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT
        (SELECT COUNT(*) FROM users_in_scope) AS users_total,
        (SELECT COUNT(*) FROM users_in_scope WHERE active) AS users_active,
        (SELECT COUNT(*) FROM users_in_scope WHERE "createdAt" >= $1 AND "createdAt" < $2) AS registered,
        (SELECT COUNT(*) FROM scope) AS profiles_total`),
    );
  }

  // ARCHITECTURE.md §8: register → onboarded → watched ≥3 → first triad →
  // three triads (the first result's threshold) → trained → shown a result
  // → returned (activity on two distinct days). Cohort: accounts registered
  // in the window, followed to now, not only inside the window.
  private funnel(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT
        COUNT(*) AS registered,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM profiles p WHERE p."userId" = u.id AND p.market IS NOT NULL)) AS onboarded,
        COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM user_title_states s JOIN profiles p ON p.id = s."profileId" WHERE p."userId" = u.id AND s.state = 'watched') >= 3) AS watched3,
        COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM triads t JOIN profiles p ON p.id = t."profileId" WHERE p."userId" = u.id AND t.status = 'completed') >= 1) AS first_triad,
        COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM triads t JOIN profiles p ON p.id = t."profileId" WHERE p."userId" = u.id AND t.status = 'completed') >= 3) AS three_triads,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_model_snapshots m JOIN profiles p ON p.id = m."profileId" WHERE p."userId" = u.id)) AS trained,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM recommendations r JOIN profiles p ON p.id = r."profileId" WHERE p."userId" = u.id)) AS shown_result,
        COUNT(*) FILTER (WHERE (SELECT COUNT(DISTINCT d) FROM (
            SELECT date(t."answeredAt") AS d FROM triads t JOIN profiles p ON p.id = t."profileId" WHERE p."userId" = u.id AND t."answeredAt" IS NOT NULL
            UNION SELECT date(w."createdAt") FROM watch_events w JOIN profiles p ON p.id = w."profileId" WHERE p."userId" = u.id
            UNION SELECT date(s."updatedAt") FROM user_title_states s JOIN profiles p ON p.id = s."profileId" WHERE p."userId" = u.id
          ) x) >= 2) AS returned
      FROM users_in_scope u WHERE u."createdAt" >= $1 AND u."createdAt" < $2`),
    );
  }

  private funnelSteps(row: Record<string, unknown>): FunnelStep[] {
    const order: Array<[string, string]> = [
      ['registered', 'registered'],
      ['onboarded', 'onboarded'],
      ['watched_3', 'watched3'],
      ['first_triad', 'first_triad'],
      ['three_triads', 'three_triads'],
      ['trained', 'trained'],
      ['shown_result', 'shown_result'],
      ['returned', 'returned'],
    ];
    let previous: number | null = null;
    return order.map(([step, column]) => {
      const count = num(row[column]);
      const entry: FunnelStep = { step, count, rate: previous === null ? 1 : rate(count, previous) };
      previous = count;
      return entry;
    });
  }

  private triadCounts(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT
        COUNT(*) FILTER (WHERE t.status = 'completed' AND COALESCE(t."answeredAt", t."createdAt") >= $1 AND COALESCE(t."answeredAt", t."createdAt") < $2) AS completed,
        COUNT(*) FILTER (WHERE t.status = 'skipped' AND t."createdAt" >= $1 AND t."createdAt" < $2) AS skipped,
        COUNT(*) FILTER (WHERE t.status = 'active') AS active
      FROM triads t JOIN scope s ON s.id = t."profileId"`),
    );
  }

  // Seconds from shownAt to answeredAt: the "does a triad tire people"
  // measure of the Alpha gate (BP §17.2). Only rounds with both stamps.
  private answerSeconds(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT
        COUNT(*) AS samples,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY x.seconds) AS median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY x.seconds) AS p90,
        AVG(x.seconds) AS mean
      FROM (
        SELECT EXTRACT(EPOCH FROM (t."answeredAt" - t."shownAt")) AS seconds
        FROM triads t JOIN scope s ON s.id = t."profileId"
        WHERE t.status = 'completed' AND t."shownAt" IS NOT NULL AND t."answeredAt" IS NOT NULL
          AND t."answeredAt" >= $1 AND t."answeredAt" < $2 AND t."answeredAt" >= t."shownAt"
      ) x`),
    );
  }

  private recommendationCounts(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT COUNT(*) AS shown, COUNT(DISTINCT r."requestId") AS requests, COUNT(DISTINCT r."profileId") AS profiles
      FROM recommendations r JOIN scope s ON s.id = r."profileId"
      WHERE COALESCE(r."shownAt", r."createdAt") >= $1 AND COALESCE(r."shownAt", r."createdAt") < $2`),
    );
  }

  private watchLag(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT COUNT(*) AS samples, percentile_cont(0.5) WITHIN GROUP (ORDER BY x.hours) AS median
      FROM (
        SELECT EXTRACT(EPOCH FROM (o."occurredAt" - COALESCE(r."shownAt", r."createdAt"))) / 3600 AS hours
        FROM outcomes o JOIN recommendations r ON r.id = o."recommendationId" JOIN scope s ON s.id = r."profileId"
        WHERE o.type = 'watched' AND o."occurredAt" >= $1 AND o."occurredAt" < $2
      ) x`),
    );
  }

  private modelCounts(params: unknown[]) {
    return this.one(
      params,
      this.scoped(`SELECT
        (SELECT COUNT(*) FROM user_model_snapshots m JOIN scope s ON s.id = m."profileId" WHERE m."createdAt" >= $1 AND m."createdAt" < $2) AS snapshots,
        (SELECT COUNT(DISTINCT m."profileId") FROM user_model_snapshots m JOIN scope s ON s.id = m."profileId") AS profiles,
        (SELECT AVG(l."heldOutPairwiseAccuracy") FROM (SELECT DISTINCT ON ("profileId") * FROM user_model_snapshots ORDER BY "profileId", "createdAt" DESC) l JOIN scope s ON s.id = l."profileId") AS mean_acc`),
    );
  }

  private async catalog(): Promise<Record<string, unknown>> {
    const rows = (await this.dataSource.query(`SELECT
        (SELECT COUNT(*) FROM titles) AS titles,
        (SELECT COUNT(*) FROM titles WHERE fingerprint IS NOT NULL) AS with_fingerprint,
        (SELECT COUNT(*) FROM titles WHERE (fingerprint->'v2') IS NOT NULL) AS with_v2,
        (SELECT COUNT(DISTINCT "titleId") FROM source_records WHERE "titleId" IS NOT NULL AND "licenseStatus" <> 'unknown') AS with_license,
        (SELECT COUNT(*) FROM content_features WHERE "supersededBy" IS NULL AND "reviewStatus" = 'unreviewed') AS unreviewed`)) as Array<Record<string, unknown>>;
    return rows[0] ?? {};
  }

  private async privacy(params: unknown[]) {
    const [byType, pending, audit] = await Promise.all([
      this.groupBy(params.slice(0, 2), `SELECT type AS key, COUNT(*) AS count FROM privacy_requests WHERE "requestedAt" >= $1 AND "requestedAt" < $2 GROUP BY 1`),
      this.scalar([], `SELECT COUNT(*) AS n FROM privacy_requests WHERE type = 'delete' AND status = 'scheduled'`),
      this.scalar(params.slice(0, 2), `SELECT COUNT(*) AS n FROM audit_log WHERE "createdAt" >= $1 AND "createdAt" < $2`),
    ]);
    return { byType, pending, audit };
  }

  private async daily(params: unknown[]) {
    return (await this.dataSource.query(
      this.scoped(`SELECT d.day::date::text AS day,
        (SELECT COUNT(*) FROM users_in_scope u WHERE date(u."createdAt") = d.day) AS registrations,
        (SELECT COUNT(*) FROM triads t JOIN scope s ON s.id = t."profileId" WHERE t.status = 'completed' AND date(COALESCE(t."answeredAt", t."createdAt")) = d.day) AS triads,
        (SELECT COUNT(*) FROM recommendations r JOIN scope s ON s.id = r."profileId" WHERE date(COALESCE(r."shownAt", r."createdAt")) = d.day) AS shown,
        (SELECT COUNT(*) FROM outcomes o JOIN recommendations r ON r.id = o."recommendationId" JOIN scope s ON s.id = r."profileId" WHERE o.type = 'watched' AND date(o."occurredAt") = d.day) AS watched
      FROM generate_series(date($1), date($2) - interval '1 day', interval '1 day') AS d(day)
      ORDER BY d.day`),
      params,
    )) as Array<{ day: string; registrations: string; triads: string; shown: string; watched: string }>;
  }
}

export { rate as metricsRate };
