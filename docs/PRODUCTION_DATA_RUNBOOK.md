# Production data runbook (Railway, `Postgres-eu`)

Pinned to `a2ca8ba` (2026-09-06). Code ships itself; **data does not** — this is the split (ADR-90, ADR-118 incident note).

**Automatic on every deploy** (pre-deploy command `npm run release --workspace=@movie/backend`): migrations (`node dist/migrate.js`, log `[migrate]`), then the catalog reseed from `catalog.demo.json` — `titles` upsert **including `posterPath`**, rights rows, IMDb ratings. It never touches `titles.publishedRevisionId` or `title_posters`.

**Manual, once per database** (run inside the backend container: Railway → `@movie/backend` → **Console**; its `DATABASE_URL` is the live one, no secrets needed). Readbacks run in Railway → `Postgres-eu` → **Console** with `psql -c '…'`.

| Step | Command in the backend container | Readback (`psql`) |
|---|---|---|
| 1. Publish what passes `public-v1` | `node apps/backend/dist/scripts/pub-1d9-initial-publish.js` (add `--dry-run` first; idempotent, one transaction per title) | `SELECT count(*) FILTER (WHERE "publishedRevisionId" IS NOT NULL) AS published, count(*) FILTER (WHERE "posterPath" IS NULL) AS poster_missing FROM titles;` |
| 2. Multi-poster carousel | `node apps/backend/dist/scripts/fetch-tmdb-posters.js --backfill-db` (idempotent; `--force --only DEMO0001,…` to redo specific titles) | `SELECT count(*) AS rows, count(DISTINCT "titleId") AS titles FROM title_posters;` |
| 3. A title with no poster | **Never database-only** (the next reseed nulls it): run `pub-b1-poster-backfill` in a source checkout, commit `catalog.demo.json`, deploy; the reseed applies it, then step 1 publishes it. The script refuses to run without the fixture. | `SELECT "internalId" FROM titles WHERE "posterPath" IS NULL;` |

Order after a fresh or restored database: deploy → 1 → 2 → readbacks → `GET https://api.kolme.app/api/health` (raw count, bypasses the guard) → search on kolme.app. A deploy with `published = 0` serves an **empty catalogue** on every guarded path (search, starter, detail, recommendations, triads, state/watch-events): that is the 2026-09-06 outage, not a bug in the guard. `Postgres` (US, legacy) is not the live database — read only `Postgres-eu`.
