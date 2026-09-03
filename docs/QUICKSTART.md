# Quickstart — local development

Runs the current vertical slice on your machine: register → mark films watched → rank triads → train a model → see a recommendation list. Verified on Windows 11 (Git Bash), Node 22, Python 3.14, Docker Desktop, on 2026-09-03.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js + npm | 22.x / 10.x | `node --version` |
| Docker Desktop | current | Postgres (pgvector image) + Redis |
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
| `REDIS_URL` | `redis://localhost:6379` | reserved (unused today) |
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

Starts `movie-postgres` (host port 5433), `movie-redis` (6379) and `movie-postgres-test` (5544, disposable, for e2e tests). Check with `docker ps`.

The compose project name is pinned to `movie` in `docker/docker-compose.yml`, so every invocation (root scripts, `apps/backend` e2e, the Makefile) lands in one project and volumes are named `movie_postgres_data` / `movie_redis_data`. Containers created before that line existed show under a `docker` group in Docker Desktop and need a one-time recreate that keeps their data; the steps are in the comment at the top of `docker/docker-compose.yml`.

## 4. Database

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Migrations create the 7 tables in [SCHEMA.md](SCHEMA.md) §1; the seed inserts 15 development titles with placeholder fingerprints (idempotent upsert).

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

The e2e suite starts `postgres-test`, runs migrations against it and proves cross-user access is blocked; it never touches the dev database.

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

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `POSTGRES_PASSWORD environment variable is required` | `.env` missing or not copied | step 2 |
| `JWT_SECRET environment variable is required` | same | set any non-empty value locally |
| backend connects but tables are missing | migrations not run | `npm run db:migrate` |
| `relation "triads" does not exist` in the trainer | trainer points at another DB | `DATABASE_URL` must use port 5433 |
| port in use (3000/3101/5433/6379/5544) | another process/container | `netstat -ano \| findstr :3101` on Windows, `lsof -i :3101` on macOS/Linux; stop it or change the port |
| Rank tab says "mark at least three films" | fewer than 3 watched titles for the profile | Discover → mark more |
| My list shows "not ready yet" | no model snapshot | run the trainer (step 6.4) |
| e2e fails to connect on 5544 | `postgres-test` not healthy yet | `docker ps`, retry |
| fresh clone: backend can't authenticate to Postgres (`password authentication failed`) | Compose resolves `.env` relative to the *compose file's* directory (`docker/`), not the repo root, so `POSTGRES_PASSWORD` silently fell back to `postgres` on first `docker:up` while the backend's own `.env` expects `dev_password_change_in_production` (H5, [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-38) | already fixed in `docker:up`/`docker:down`/`test:e2e:up`/`docker-logs` (`--project-directory .`, or `../..` from `apps/backend`) as of this revision — if you still hit it, your Postgres volume was initialized before the fix; `docker compose -f docker/docker-compose.yml down -v` and re-run step 2 |
| CRLF warnings from git | Windows autocrlf | harmless |

## 10. Where to go next

- What this slice is missing versus the product: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- Contracts to implement against: [API.md](API.md), [SCHEMA.md](SCHEMA.md), [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md), [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md)
- The product itself: [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md)

---

**Changelog**
- 2.1 (2026-09-03): added the fresh-clone Postgres-password troubleshooting row (H5, ADR-38) now that `docker:up`/`docker:down`/`test:e2e:up`/`docker-logs` correctly resolve the root `.env`.
- 2.1 (2026-09-03): enrichment worker moved to the Anthropic Messages API — `ANTHROPIC_*` variables replace `OPENAI_*`, the pip line matches `pyproject.toml`, `make catalog-fetch` / `make catalog-enrich` added for the demo catalog ([DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md)).
- 2.0 (2026-09-03): added the missing migrate/seed/train steps (the previous guide went from `docker:up` straight to `npm run dev`, which cannot work with `synchronize: false`), corrected framework versions, removed the OpenAI-key prerequisite and the ad-hoc endpoint list, added Windows notes.
