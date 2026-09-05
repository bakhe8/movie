# Quickstart — local development

Runs the current vertical slice on your machine: register → mark films watched → rank triads → train a model → see a recommendation list. Verified on Windows 11 (Git Bash), Node 22, Python 3.14, Docker Desktop, on 2026-09-03.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js + npm | 22.x / 10.x | `node --version` |
| Docker Desktop | current | Postgres 15 (`pgvector/pgvector:0.8.6-pg15`, pinned) |
| Python | 3.11+ | model service; `pip` or Poetry |
| Git | any | |

An Anthropic key is **not** needed for the core loop; fingerprints are seeded. It is only needed to run the enrichment worker (`make catalog-enrich`).

## 1. Install

```bash
git clone <repo-url> movie && cd movie
npm install
```

Python (pick one):

```bash
# Poetry
cd services/workers && poetry install && cd ../..
```

```bash
# plain pip
python -m pip install numpy scipy pydantic psycopg2-binary anthropic python-dotenv pytest ruff
```

## 2. Environment

```bash
cp .env.example .env
```

`.env` is read by the backend, the seed script, the TypeORM CLI and the Python trainer. Keys:

| Variable | Default in `.env.example` | Used by |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `movieapp` / dev password / `moviedb` | docker compose, backend (password is **required**) |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `5433` | backend — port 5433 on the host maps to the container's 5432 |
| `DATABASE_URL` | same values as above | Python trainer |
| `API_PORT` | `3101` | backend |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3101/api` | frontend (also in `apps/frontend/.env.local`) |
| `FRONTEND_URL` | not set → `http://localhost:3000` | backend CORS origin |
| `JWT_SECRET` | placeholder — **required** | backend |
| `ANTHROPIC_API_KEY` | empty — add yours, or sign in with `ant auth login` | enrichment worker only |
| `ANTHROPIC_WORKSPACE_ID` | empty — needed only for an identity-linked key (the API otherwise answers 400 "anthropic-workspace-id is required") | enrichment worker only |
| `ANTHROPIC_FINGERPRINT_MODEL` / `ANTHROPIC_EXPLANATION_MODEL` | a current model id | enrichment worker — it refuses to start without them (ADR-6: model ids are configuration) |

## 3. Infrastructure

```bash
npm run docker:up
```

Starts `movie-postgres` (host port 5433). Check with `docker ps`. The e2e test suite's database (`moviedb_test`) lives inside this same Postgres instance, not a separate container (board C-17, 2026-09-04) — `npm run test:e2e:up` (from `apps/backend`) creates it the first time, idempotently.

The compose project name is pinned to `movie` in `docker/docker-compose.yml`, so every invocation (root scripts, `apps/backend` e2e, the Makefile) lands in one project and the volume is named `movie_postgres_data`. Containers created before that line existed show under a `docker` group in Docker Desktop and need a one-time recreate that keeps their data; the steps are in the comment at the top of `docker/docker-compose.yml`.

## 4. Database

```bash
npm run db:migrate
```

```bash
npm run db:seed:demo
```

Migrations create the tables in [SCHEMA.md](SCHEMA.md) §1; this seed upserts the 300-title demo catalog (fingerprints included, from the fixture already in the repo) and rebuilds the four demo persona accounts, idempotently — see §6.1. The 15-placeholder-title seed (`npm run db:seed`, `apps/backend/src/scripts/seed.ts`) is retired from `movie-postgres` (board C-15, owner's "never 15" rule, 2026-09-03) and kept only as a fixture for the e2e suite's own `moviedb_test` database.

## 5. Run

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3101/api (health: http://localhost:3101/api/health)

`npm run dev` for the backend builds with `tsc` then runs `dist/main.js` (no watch mode); restart it after backend changes. The frontend uses Next.js dev with hot reload.

## 6. Walk the loop

1. Open the frontend, create an account. A profile named «ملف الذوق الرئيسي» is created automatically.
2. **اكتشف / Discover**: search and mark at least 3 films as watched (more gives more triads).
3. **رتّب / Rank**: reorder the three cards (drag or ↑/↓) and save; the next triad loads.
4. Train the model for your profile (profile id from `GET /api/profiles` with your token, or from the database):

```bash
cd services/workers && python -m src.training <profile-uuid>
```

(with Poetry: `poetry run python -m src.training <profile-uuid>`)

Or run `make model-service` (the training HTTP service on 127.0.0.1:8001) before starting the backend so training happens automatically after each completed triad; without it, training stays this manual step.

5. **قائمتي / My list** now shows a recommendation list computed from the snapshot. Until a snapshot exists the API answers 409 and the UI shows "not ready yet".

### 6.1 Demo data instead of walking the loop by hand

```bash
make demo
```

Upserts the 300-title demo catalog (`apps/backend/src/scripts/fixtures/catalog.demo.json`, fingerprints included) and rebuilds four synthetic accounts with their activity, then trains each one. Sign in as `slow-burn@demo.local` (band strong), `spectacle@demo.local` (likely, with an open ranking round), `warm-talky@demo.local` (initial) or `newcomer@demo.local` (inconclusive); the password is in `fixtures/personas.demo.json`. Re-running is idempotent; `make demo-clean` removes the accounts and keeps the titles. Everything is described in [DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md), including what no demo data can show (public quality, availability).

## 7. Tests and checks

```bash
npm run test -w apps/backend
```

```bash
cd apps/backend && npm run test:e2e
```

```bash
cd services/workers && python -m pytest -q
```

```bash
cd apps/backend && npx tsc --noEmit
```

```bash
cd apps/frontend && npx tsc --noEmit
```

The e2e suite runs migrations against `moviedb_test` (a separate database, same Postgres instance as dev since board C-17) and proves cross-user access is blocked; it never touches the `moviedb` dev database.

## 8. Useful commands

```bash
npm run docker:down
```

```bash
docker compose -f docker/docker-compose.yml logs -f
```

```bash
cd apps/backend && npm run migration:generate -- src/migrations/<Name>
```

`make` targets mirror the npm scripts (`make help`) but `make` is not required on Windows.

### 8.1 Staging / production build (ALPHA_PLAN 7.3, 7.4)

Not this quickstart's dev stack — a separate compose file with its own Dockerfiles, one per service:

```bash
cp docker/.env.prod.example docker/.env.prod          # fill in non-secret config
cp docker/secrets/*.txt.example docker/secrets/…       # drop the .example suffix, fill in real secrets (never .env)
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod --profile migrate up --abort-on-container-exit migrate
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d
```

Backup and restore (`docker/backup-postgres.sh`, `docker/restore-postgres.sh`) are documented and drilled in `docs/ALPHA_PLAN_2026-09-04.md` §8.12. Since AUDIT_2026-09-05 H8/H9 a backup is verified with `pg_restore --list` before it gets its name, and the restore takes the compose file as a required argument and asks for the database name to be typed back (`--yes` for a scripted drill). This is the generic self-hosted path; §8.2 below is the actual hosting decision (ADR-88).

### 8.2 Hosting: Railway + Cloudflare (ALPHA_PLAN 7.2, board C-18, owner decision O-2)

Compute on Railway (owner's account), domain `kolme.app` fronted by Cloudflare (TLS + WAF), staging on `alpha.kolme.app`. Full reasoning and constraints: ADR-88 in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md). **Nothing below has been deployed yet — it is a plan for the owner to execute and approve, per board C-18.**

Four Railway services (live, `backend` and `frontend` are built by Railway's Railpack from the workspace, not from the Dockerfiles — those remain the self-host/compose path):

| Service | Config-as-code path | Public domain | Notes |
|---|---|---|---|
| `postgres` | — (deploy from Docker image `pgvector/pgvector:0.8.6-pg15` — pinned, PG 15 like the existing volume (ADR-98) — not Railway's own Postgres plugin, which doesn't ship pgvector) | none (private) | Attach a Railway Volume at `/var/lib/postgresql/data`. Region: **EU-West** (Railway has no Middle East region). Railway's own backup/PITR tier on a bring-your-own-image service is more limited than a fully managed Postgres — run `docker/backup-postgres.sh` on a schedule (Railway Cron service) until/unless this moves to a managed provider |
| `backend` | `apps/backend/railway.json` | `api.kolme.app` / `api.alpha.kolme.app` | Root directory = repo root. **Pre-deploy command** `npm run release --workspace=@movie/backend` (Settings → Deploy): migrations, then the catalog seed (`seed-demo --catalog-only`, no persona accounts), the rights-registry rows and the IMDb ratings, in the same image before every deployment — idempotent, and a failure stops the deploy (ADR-90). The catalog is never a separate manual step |
| `frontend` | `apps/frontend/railway.json` | `kolme.app` / `alpha.kolme.app` | Root directory = repo root |
| `model-service` (workers) | `services/workers/railway.json` | none (private, reached via `MODEL_SERVICE_URL`) | Root directory = repo root |

**Environment variables** (Railway "Variables", not files — unlike `docker-compose.prod.yml`'s file-based secrets, which target a generic self-host, not Railway. The `<NAME>_FILE` convention in the existing images is a no-op when the plain `<NAME>` variable is already set, so no Dockerfile changes were needed):

| Variable | Set on | Value |
|---|---|---|
| `DATABASE_URL` | `backend`, `model-service` | `postgresql://movieapp:<password>@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/moviedb` — build with Railway's `${{ServiceName.VAR}}` reference picker in the dashboard; A-14 made `DATABASE_URL` win over `DB_*` in `database.config.ts`, so this one variable is enough for the backend too now |
| `MODEL_SERVICE_URL` | `backend` | `http://${{model-service.RAILWAY_PRIVATE_DOMAIN}}:8001` |
| `NEXT_PUBLIC_API_URL` | `frontend` | `https://api.kolme.app/api` (prod) / `https://api.alpha.kolme.app/api` (staging) |
| `JWT_SECRET`, `ANTHROPIC_API_KEY`, `TMDB_API_KEY`, `MODEL_SERVICE_TOKEN`, `AUDIT_IP_SALT` | `backend` (as needed) | generate fresh values — never reuse `.env`'s dev placeholders |
| `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB` | `postgres` | generate a fresh password; `movieapp` / `moviedb` |
| `API_PORT`, `PORT`, `MODEL_SERVICE_PORT` | each service | `3101` / `3110` / `8001` (Railway also injects its own `PORT`; keep these explicit since the app code reads them by these names) |
| `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM_ADDRESS` (optional `MAIL_OUTBOX_SWEEP_INTERVAL_MS`) | `backend` | mail (ADR-85/97): `resend` — one HTTPS request, the only transport that works on Railway below Pro (outbound SMTP is Pro-only); `kolme.app` is verified there (auto-configured via Cloudflare). `log` is refused in production. `smtp` (+ `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`) is the VPS path. Queued mail and its state: `GET /api/admin/mail-outbox` |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLE_RATE` | `backend` | observability (A-11/ADR-86) — unset in dev, Sentry and tracing each start only when their variable is set here; the last two default to `reel-backend` and `1` (`.env.example`) |

Prove delivery before trusting a provider (ADR-97): `npx tsx apps/backend/src/scripts/mail-probe.ts you@example.com` sends one probe through the configured transport and the outbox — the exact path a password-reset mail takes — and prints the row's state; run it with the live variables (`railway run …`) to see the message land in a real mailbox.

**Owner's click list, in order** (nothing here has been done yet):

1. Railway dashboard → New Project → Deploy from GitHub repo → `bakhe8/movie`.
2. Add the `postgres` service: Docker Image → `pgvector/pgvector:0.8.6-pg15`, region EU-West, attach a Volume at `/var/lib/postgresql/data`, set its three variables above.
3. Add `backend`: from the same GitHub repo, root directory `/`, config-as-code path `apps/backend/railway.json`; set its variables.
4. On `backend`, Settings → Deploy → Add pre-deploy step: `npm run release --workspace=@movie/backend`. Its first deployment then creates the schema and loads the catalog before the app receives traffic, and every later deployment repeats the (idempotent) release first. No separate migrate service.
5. Add `model-service`: same repo/root, config-as-code path `services/workers/railway.json`; set its variables.
6. Add `frontend`: same repo/root, config-as-code path `apps/frontend/railway.json`; set `NEXT_PUBLIC_API_URL` once `backend`'s domain is known (step 7).
7. In Railway, generate/attach custom domains: `api.kolme.app` → `backend`, `kolme.app` → `frontend` (and the `alpha.` pair for staging, as a second environment or a second project).
8. In Cloudflare (`kolme.app` zone): add CNAME records for `kolme.app`/`www`, `api`, `alpha`, `api.alpha` pointing at the hostnames Railway generated in step 7; proxy (orange cloud) on for TLS/WAF.
9. Verify: `https://kolme.app` loads, `https://api.kolme.app/api/health` answers, register → watch → rank → train → recommendations end to end (same walk as §6) against the live URL.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `POSTGRES_PASSWORD environment variable is required` | `.env` missing or not copied | step 2 |
| `JWT_SECRET environment variable is required` | same | set any non-empty value locally |
| backend connects but tables are missing | migrations not run | `npm run db:migrate` |
| `relation "triads" does not exist` in the trainer | trainer points at another DB | `DATABASE_URL` must use port 5433 |
| port in use (3000/3101/5433/6379) | another process/container | `netstat -ano \| findstr :3101` on Windows, `lsof -i :3101` on macOS/Linux; stop it or change the port |
| Rank tab says "mark at least three films" | fewer than 3 watched titles for the profile | Discover → mark more |
| My list shows "not ready yet" | no model snapshot | run the trainer (step 6.4) |
| e2e fails to connect / migrate | `movie-postgres` not healthy yet, or `moviedb_test` not created yet | `docker ps`; `npm run test:e2e:up` (from `apps/backend`) creates `moviedb_test` idempotently |
| fresh clone: backend can't authenticate to Postgres (`password authentication failed`) | Compose resolves `.env` relative to the *compose file's* directory (`docker/`), not the repo root, so `POSTGRES_PASSWORD` silently fell back to `postgres` on first `docker:up` while the backend's own `.env` expects `dev_password_change_in_production` (H5, [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-38) | already fixed in `docker:up`/`docker:down`/`test:e2e:up`/`docker-logs` (`--project-directory .`, or `../..` from `apps/backend`) as of this revision — if you still hit it, your Postgres volume was initialized before the fix; `docker compose -f docker/docker-compose.yml down -v` and re-run step 2 |
| CRLF warnings from git | Windows autocrlf | harmless |

## 10. Where to go next

- What this slice is missing versus the product: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- Contracts to implement against: [API.md](API.md), [SCHEMA.md](SCHEMA.md), [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md), [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md)
- The product itself: [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md)

---

**Changelog**
- 2.9 (2026-09-05): §8.2 — the release step moved to `backend`'s pre-deploy command; the separate `migrate` service and `railway.migrate.json` are retired (ADR-90 addendum).
- 2.8 (2026-09-05): §8.2's `migrate` service is the release step — `node dist/migrate.js` runs the migrations and then the catalog seed, rights rows and IMDb ratings in one process (ADR-90); the catalog is never loaded by hand.
- 2.7 (2026-09-05): §8.2's `migrate` service runs `npm run migrate:prod` (the compiled entry point, A-19) — `npm run migrate` needs ts-node, absent from the production image; `OTEL_SERVICE_NAME`/`OTEL_TRACES_SAMPLE_RATE` added to the variable list.
- 2.6 (2026-09-05): §8.1/§8.2 cited ADR-87 as the hosting decision; it is ADR-88 (ADR-87 is the training-trigger timing fix). Corrected here and in the 2.5 entry (AUDIT_2026-09-05 §4).
- 2.5 (2026-09-04): §8.2 added — the actual hosting plan (Railway + Cloudflare, `kolme.app`/`alpha.kolme.app`, ADR-88, owner decision O-2, board C-18). Nothing deployed yet; a click list for the owner to execute and approve.
- 2.4 (2026-09-04): the disposable `postgres-test` container is gone (board C-17, owner's order); the e2e suite's `moviedb_test` database now lives inside `movie-postgres` itself, same port. `npm run test:e2e:up` creates it idempotently.
- 2.3 (2026-09-04): §4's seed step is `db:seed:demo` (the 300-title catalog), not `db:seed` (the 15 `FILM*` placeholders, retired from `movie-postgres`, board C-15).
- 2.2 (2026-09-04): §8.1 added — the staging/production build (ALPHA_PLAN 7.3/7.4: per-service Dockerfiles, `docker-compose.prod.yml`, backup/restore) is now in this guide, not just in ARCHITECTURE.md's table (board C-13).
- 2.1 (2026-09-03): added the fresh-clone Postgres-password troubleshooting row (H5, ADR-38) now that `docker:up`/`docker:down`/`test:e2e:up`/`docker-logs` correctly resolve the root `.env`.
- 2.1 (2026-09-03): enrichment worker moved to the Anthropic Messages API — `ANTHROPIC_*` variables replace `OPENAI_*`, the pip line matches `pyproject.toml`, `make catalog-fetch` / `make catalog-enrich` added for the demo catalog ([DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md)).
- 2.0 (2026-09-03): added the missing migrate/seed/train steps (the previous guide went from `docker:up` straight to `npm run dev`, which cannot work with `synchronize: false`), corrected framework versions, removed the OpenAI-key prerequisite and the ad-hoc endpoint list, added Windows notes.
