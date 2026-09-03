# Architecture Overview

> This document is already close to [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) §12 (Modular Monolith first, PostgreSQL + pgvector, Python worker for the ranking model, no microservices/Kafka/GraphDB until load justifies it) — no structural conflict found. Two things worth keeping in sync as the schema evolves: recommendations should carry three separate scores (Personal Fit / Public Quality / Watchability) end-to-end rather than a single `score`, per [schema.md](schema.md); and the `profiles`/`users` split should stay the account-identity vs. pseudonymous-taste-id boundary described in §13.1/§21.1, reflected in the entity layer (`profile.entity.ts` referencing `profileId`, not raw account fields, in triad/recommendation code paths).

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        👤 END USER (Browser/PWA)                             │
└───────────────────────────────────────────────────────────┬───────────────────┘
                                                            │
                                                   HTTP/REST API
                                                            │
                    ┌───────────────────────────────────────┼──────────────────────┐
                    │                                       │                      │
        ┌───────────▼─────────┐            ┌───────────────▼──────────┐           │
        │   Next.js PWA       │            │   NestJS API Server      │           │
        │                     │            │                          │           │
        │  Port 3000          │            │  Port 3101               │           │
        │ ┌─────────────────┐ │            │ ┌────────────────────┐  │           │
        │ │ Auth Pages      │ │            │ │ REST Endpoints     │  │           │
        │ │ Triad Ranking   │ │   HTTP     │ │ - /auth            │  │           │
        │ │ Film Search     │ │◄──────────►│ │ - /profiles        │  │           │
        │ │ Recommendations │ │            │ │ - /titles          │  │           │
        │ │ Dashboard       │ │            │ │ - /triads          │  │           │
        │ │                 │ │            │ │ - /recommendations │  │           │
        │ │ TypeScript      │ │            │ │                    │  │           │
        │ │ React 18        │ │            │ │ TypeScript         │  │           │
        │ │ Tailwind CSS    │ │            │ │ Decorators         │  │           │
        │ └─────────────────┘ │            │ └────────────────────┘  │           │
        └─────────┬───────────┘            └────────────┬────────────┘           │
                  │                                     │                        │
                  │                    PostgreSQL (TypeORM)                      │
                  └─────────────────────────┬───────────────────────────────────┘
                                            │
                                            │
                    ┌───────────────────────▼──────────────┐
                    │                                      │
            ┌───────▼──────┐                    ┌──────────▼────────┐
            │  PostgreSQL  │                    │    Redis Cluster  │
            │  (+ pgvector)│                    │                   │
            │              │                    │ Port 6379         │
            │ ┌──────────┐ │                    │                   │
            │ │ users    │ │                    │ Session Store     │
            │ │ profiles │ │                    │ Job Queue (Bull)  │
            │ │ titles   │ │                    │ Cache Layer       │
            │ │ triads   │ │                    └───────────────────┘
            │ │embeddings│ │
            │ │recommend │ │
            │ │  ations  │ │
            │ └──────────┘ │
            │              │
            │ pgvector for │
            │ similarity   │
            │ search       │
            └──────────────┘
                  ▲
                  │ SQL Queries
                  │
            ┌─────┴───────────────────────────────────────┐
            │                                             │
      ┌─────▼──────────┐                        ┌────────▼─────────┐
      │  Python Worker │                        │ OpenAI API       │
      │  (Background   │                        │                  │
      │   Processing)  │                        │ - Fingerprinting │
      │                │────── HTTP ────────►   │ - Explanations   │
      │ Plackett-Luce  │                        │                  │
      │ Ranking Engine │                        │ (Batch + Async)  │
      │                │                        │                  │
      │ - Training     │                        │ Store: false     │
      │ - Scoring      │                        │ (No training)    │
      │ - Evaluation   │                        │                  │
      │                │                        │                  │
      │ NumPy/SciPy    │                        │ model tier TBD   │
      └────────────────┘                        │ (pick per task at │
                                                │  implementation   │
                                                │  time; don't      │
                                                │  hard-code a name │
                                                │  here)            │
                                                └──────────────────┘
```

## Data Flow: Triadic Ranking

```
User Ranks Films
     │
     ├─► Frontend sends POST /triads
     │   {
     │     profileId: UUID,
     │     titles: [id1, id2, id3],
     │     ranking: [0, 1, 2]
     │   }
     │
     ├─► NestJS API validates & stores
     │   (TriadsService)
     │
     ├─► Emit event to Redis Job Queue
     │   (Bull job)
     │
     └─► Python Worker processes asynchronously:
         1. Retrieve user's current weights
         2. Add triad to training batch
         3. Refit Plackett-Luce model
         4. Compute new weights
         5. Update database
         6. Clear recommendations cache
         7. Generate next triad
```

## Data Flow: Film Fingerprinting

```
New Film Added to Catalog
     │
     ├─► Backend receives film metadata
     │
     ├─► Job queued in Redis (Bull)
     │
     └─► Python Worker processes:
         1. Fetch film description & plot
         2. Call OpenAI Responses API
         3. Parse structured JSON fingerprint
         4. Compute embedding — model choice is an open implementation decision, not
            fixed by the blueprint; its own external references (Appendix د, م24) cite
            text-embedding-3-large specifically, so treat that as the default unless a
            benchmark justifies the cheaper -small variant
         5. Store fingerprint in PostgreSQL
         6. Store embedding in pgvector
         7. Update global model metadata
```

## Data Flow: Recommendation Generation

```
User Opens Recommendations Page
     │
     ├─► Frontend fetches GET /profiles/{id}/recommendations
     │
     ├─► NestJS checks cache (Redis)
     │   Cache miss → proceed to compute
     │
     ├─► NestJS retrieves:
     │   - User's preference model (latest snapshot)
     │   - All unwatched titles
     │   - Title fingerprints
     │
     ├─► Scores all titles — three separate values, never merged (blueprint §4.4):
     │   personal_fit_i   = weights · fingerprint_i + bias_i
     │   public_quality_i = normalized critic/audience prior (independent source)
     │   watchability_i    = market/platform/dub-subtitle availability now
     │
     ├─► Sort candidates by personal_fit within each of 3 tracks (safe/discovery/outside-usual),
     │   filter by:
     │   - Not watched
     │   - Not in watchlist
     │   - Available in Saudi Arabia (future: JustWatch) — a filter, not a ranking factor
     │
     ├─► Select top recommendations (e.g., 10), each carrying personal_fit, public_quality,
     │   watchability, and a confidence BAND (not a raw %, until calibrated — blueprint §7.2)
     │
     └─► Optional: Call OpenAI for explanations (batch/async)
         explanation = "Based on your preference for [dims]
                       and similarity to [watched films]..." (no-spoiler, generated only
                       from features that actually drove the score — blueprint §9.4)
```

## Deployment Topology

### Local Development
```
Docker Compose
├── PostgreSQL (host port 5433, container port 5432)
├── Redis (port 6379)
│
Node (npm dev)
├── Next.js dev server (port 3000)
└── NestJS dev server (port 3101)

Python (local)
└── Ranker / Enrichment worker (manual or pytest)
```

### Staging/Production
```
AWS / GCP / Azure

┌─────────────────────────────────────────────────┐
│            CloudFront / CDN                      │
│         (Static assets caching)                  │
└─────────────────┬───────────────────────────────┘
                  │
      ┌───────────┼──────────────┐
      │           │              │
┌─────▼─────┐  ┌──▼────────┐   ┌─▼──────────────┐
│  Vercel   │  │  Lambda   │   │  Lambda Concur │
│ (Nextjs)  │  │ (NestJS)  │   │   (Workers)    │
│           │  │           │   │                │
│ CDN ✓     │  │ Auto-scale│   │ Scheduled      │
│ Regions   │  │ (API)     │   │ Fingerprinting │
└───────────┘  └──┬────────┘   └────┬───────────┘
               │                  │
               │    Query          │
               │    Write          │
               │    Events         │
               │                   │
     ┌─────────┴──────────────────┴─────┐
     │                                   │
  ┌──▼──────────────────────────┐  ┌────▼──────┐
  │  AWS RDS PostgreSQL          │  │  ElastiC  │
  │  (Multi-AZ, automatic backup)│  │   Cache   │
  │  + pgvector extension        │  │  (Redis)  │
  │                              │  │           │
  │  Point-in-time recovery ✓    │  │  Sessions │
  │  Encryption at rest ✓        │  │  Queues   │
  │  Automated snapshots ✓       │  │  Cache    │
  └──────────────────────────────┘  └───────────┘
```

## Module Organization (NestJS)

```
backend/src/
├── main.ts                      # Entry point
├── app.module.ts                # Root module
│
├── config/
│   ├── database.config.ts       # TypeORM setup
│   ├── jwt.config.ts            # Auth config
│   └── redis.config.ts          # Redis setup
│
├── entities/
│   ├── user.entity.ts
│   ├── profile.entity.ts
│   ├── title.entity.ts
│   ├── triad.entity.ts
│   ├── embedding.entity.ts
│   └── recommendation.entity.ts
│
├── modules/
│   ├── auth/                    # JWT authentication
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   └── jwt.strategy.ts
│   │
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.service.ts
│   │   └── users.controller.ts
│   │
│   ├── profiles/
│   │   ├── profiles.module.ts
│   │   ├── profiles.service.ts
│   │   └── profiles.controller.ts
│   │
│   ├── titles/
│   │   ├── titles.module.ts
│   │   ├── titles.service.ts
│   │   └── titles.controller.ts
│   │
│   ├── triads/
│   │   ├── triads.module.ts
│   │   ├── triads.service.ts
│   │   ├── triads.controller.ts
│   │   └── triad-generation.service.ts
│   │
│   ├── recommendations/
│   │   ├── recommendations.module.ts
│   │   ├── recommendations.service.ts
│   │   └── recommendations.controller.ts
│   │
│   └── admin/
│       ├── admin.module.ts
│       ├── admin.service.ts
│       └── admin.controller.ts
│
└── common/
    ├── guards/
    │   ├── auth.guard.ts
    │   └── role.guard.ts
    │
    ├── pipes/
    │   └── validation.pipe.ts
    │
    ├── exceptions/
    │   ├── app-error.exception.ts
    │   └── not-found.exception.ts
    │
    └── decorators/
        ├── current-user.decorator.ts
        └── roles.decorator.ts
```

## Security Model

```
Request Flow
    │
    ├─► Rate Limiting (express-rate-limit)
    │
    ├─► CORS Middleware
    │   (Allow frontend origin only)
    │
    ├─► Request Validation Pipe
    │   (Check input types & bounds)
    │
    ├─► JWT Authentication Guard
    │   (Verify token if endpoint requires auth)
    │
    ├─► Authorization Guard
    │   (Role-based access: user, admin, etc.)
    │
    ├─► Business Logic
    │   (Service layer)
    │
    └─► Database Access
        (Repository pattern with proper parameterization)
```

## Scalability Considerations

### Phase 1 (MVP: 15-150 users)
- Single NestJS instance
- Single PostgreSQL instance
- Single Redis instance
- Synchronous fingerprinting (or scheduled batch)

### Phase 2 (100-1000 users)
- Multiple NestJS instances (behind load balancer)
- PostgreSQL read replicas
- Redis cluster
- Async fingerprinting via BullMQ

### Phase 3+ (1000+ users)
- Kubernetes deployment
- Managed database (AWS RDS)
- CDN for static assets
- Microservices separation
  - API server
  - Worker server
  - Admin server

## Monitoring & Observability

```
Logging
├── Application logs (Winston / Pino)
├── Access logs (express)
└── Database query logs

Metrics
├── API response times
├── Model accuracy
├── Job queue depth
└── Database connections

Alerting
├── High error rates
├── Long-running jobs
├── Database capacity
└── API degradation
```

See [docs/deployment.md](deployment.md) for CI/CD and monitoring setup.
