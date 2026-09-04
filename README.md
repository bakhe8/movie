# Reel — movie taste platform (منصة بصمة الذوق السينمائي)

A personal film-taste assistant that learns from one question only — "rank these three films you have watched, by how much you personally liked them" — and turns the answers into a short, explained watch decision that keeps Personal Fit, Public Quality, Watchability and Confidence as separate values. Arabic-first PWA for feature films, Saudi/Gulf launch market, English supported from the infrastructure up.

**Product definition (normative, Arabic)**: [docs/movie_taste_platform_blueprint_ar.md](docs/movie_taste_platform_blueprint_ar.md). Everything else in [docs/](docs/README.md) is derived from it.

**Status (2026-09-03)**: the core loop runs locally — register → mark watched → rank triads → train a model by CLI → see a recommendation list — but fifteen pieces still fall short of the blueprint. The exact list is [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). Phase: pre-Phase-0 engineering.

## Stack (as built)

| Part | Technology |
|---|---|
| `apps/frontend` | Next.js 16 (App Router), React 19, Tailwind 4, TypeScript; RTL/LTR |
| `apps/backend` | NestJS 10, TypeORM 0.3 (migrations only), Passport JWT, class-validator, @nestjs/throttler; global prefix `/api` |
| `services/workers` | Python 3.11+, NumPy/SciPy (Plackett–Luce), Pydantic, Anthropic SDK (enrichment); Poetry |
| `packages/shared` | shared TypeScript types (fingerprint) |
| `docker/` | Dev: PostgreSQL (`ankane/pgvector`), Redis 7, disposable `postgres-test`. Staging/prod: `Dockerfile` per service, `docker-compose.prod.yml` (file-based secrets, one-shot migrations), backup/restore scripts |

## Repository layout

```
apps/backend/       NestJS API: modules (auth, profiles, titles, triads, recommendations, user-title-state), entities, migrations, seed, e2e tests
apps/frontend/      Next.js app: one page with rank / discover / list / profile views
services/workers/   Python model service: ranker, CLI trainer, enrichment worker, tests
packages/shared/    shared types
docker/             docker-compose.yml (dev) + docker-compose.prod.yml, per-service Dockerfiles, backup/restore scripts
docs/               product blueprint (AR) + derived engineering docs (EN) — start at docs/README.md
```

## Getting started

Follow [docs/QUICKSTART.md](docs/QUICKSTART.md). In short:

```bash
npm install && cp .env.example .env && npm run docker:up && npm run db:migrate && npm run db:seed:demo && npm run dev
```

Frontend http://localhost:3000 · API http://localhost:3101/api · health http://localhost:3101/api/health.

## Non-negotiables (from the blueprint `§2.4`)

The triad ranking is the only explicit preference question — no star ratings anywhere. Unwatched means unknown, never disliked. Ranking means stable personal liking, not quality or tonight's mood. Public quality, personal fit, watchability and confidence are never merged into one number. Profiles are individual, pseudonymous and private by default, with export, delete and reset. The LLM enriches and explains in the background; the measurable statistical model ranks. Every phase transition is a result gate, not a date.

## Documentation

[docs/README.md](docs/README.md) is the index: reading order by role, the document map, and the rules for keeping docs in sync with code.

## Tests

```bash
npm run test -w apps/backend
```

```bash
cd apps/backend && npm run test:e2e
```

```bash
cd services/workers && python -m pytest -q
```

GitHub Actions (`.github/workflows/ci.yml`) runs all three on every push to `main` and every pull request; a failing job blocks the merge. Enrichment has its own acceptance gates (stability drift, human-review agreement) — see [DEMO_DATA_PLAN_2026-09-03.md](docs/DEMO_DATA_PLAN_2026-09-03.md) §7.6.

## License

Not yet chosen. `apps/backend/package.json` declares MIT but no `LICENSE` file exists at the root; decide before any public release.
