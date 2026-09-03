# Quick Start Guide

Get the movie recommendation system up and running in 5 minutes.

## Prerequisites

- **Node.js 22+** - [Download](https://nodejs.org/)
- **Docker Desktop** - [Download](https://docker.com/products/docker-desktop)
- **Python 3.11+** - [Download](https://python.org/)
- **OpenAI API Key** - [Get one](https://platform.openai.com/api-keys)

## Step 1: Clone & Setup (2 min)

```bash
cd /path/to/movie
npm install
```

## Step 2: Configure Environment (1 min)

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI key:
```
OPENAI_API_KEY=sk_your_key_here
```

## Step 3: Start Infrastructure (1 min)

```bash
npm run docker:up
```

Verify containers are running:
```bash
docker ps
```

You should see:
- `movie-postgres` (PostgreSQL + pgvector)
- `movie-redis` (Redis)

## Step 4: Start Development Servers (1 min)

```bash
npm run dev
```

Open your browser:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3101
- **Health Check**: http://localhost:3101/api/health

## Common Commands

```bash
# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Stop everything
npm run docker:down

# Rebuild containers
npm run docker:down && npm run docker:up

# Run tests
npm run test

# Format code
make format
```

## File Structure Quick Reference

```
movie/
├── apps/frontend/          ← React PWA (Next.js)
├── apps/backend/           ← REST API (NestJS)
├── services/workers/       ← Python ranker & fingerprinting
├── packages/shared/        ← Shared TypeScript types
├── docker/                 ← Docker Compose setup
├── docs/                   ← Architecture, schema, privacy
└── README.md               ← Full documentation
```

## Next: Implementation Roadmap

### Backend API Endpoints (Priority)

Illustrative early build order, not the final contract — the canonical, versioned API surface is defined in blueprint §14 (`/v1/...` paths, plus a required `/triads/{id}/replace` endpoint for the neutral "haven't watched / don't remember" states):
```
POST   /auth/register
POST   /auth/login
GET    /profiles/{id}
POST   /profiles
POST   /v1/triads/next
POST   /v1/triads/{id}/rank
POST   /v1/triads/{id}/replace
GET    /v1/recommendations
GET    /titles
POST   /titles/{id}
```

### Frontend Pages (Priority)
```
/login
/register
/profile
/rank          ← Main triadic ranking interface
/recommendations
/search
/admin/dashboard
```

### Data Seed
- Create 300-500 films initially
- Generate fingerprints using OpenAI (async)
- Store in PostgreSQL with embeddings

## Troubleshooting

### "Cannot connect to database"
```bash
# Check if containers are running
docker ps | grep postgres

# Check logs
docker logs movie-postgres

# Restart
npm run docker:down
npm run docker:up
```

### "Port already in use"
```bash
# Find process using port 3000/3101/5433/6379
lsof -i :3000
lsof -i :3101

# Kill it
kill -9 <PID>
```

### "OpenAI API Error"
```bash
# Check your API key
echo $OPENAI_API_KEY

# Verify it's set in .env
cat .env | grep OPENAI
```

### Node modules issues
```bash
rm -rf node_modules package-lock.json
npm install
```

## Architecture Quick Facts

- **Frontend**: Next.js 14 + React 18 + Tailwind
- **Backend**: NestJS + TypeORM + PostgreSQL
- **Ranking Model**: Plackett-Luce (statistical learning)
- **Film Analysis**: OpenAI API (fingerprinting)
- **Embedding Search**: pgvector (PostgreSQL extension)
- **Tasks Queue**: Redis + BullMQ (future)

## Key Concepts

### Triadic Ranking
User sees 3 films and ranks them 1st, 2nd, 3rd. This trains the preference model.

### Film Fingerprint
Multiple semantic dimensions across families such as narrative, pacing, tone/emotion, characters, dialogue, style, theme, ending, people, and cultural context (blueprint §6.1) — the blueprint does not fix a total dimension count. Extracted in the background (never live), with source, confidence, extractor version, and review status per attribute (blueprint §11.3).

### Preference Model
Machine learns user's taste weights using Plackett-Luce MLE from triad rankings.

### Recommendation Score
Three separate values, never merged (blueprint §4.4): `personal_fit`, an independent `public_quality`, and a `watchability` value, plus a confidence *band* (not a raw %). `personal_fit ≈ weights · fingerprint + bias` is only an early-MVP approximation of the full utility s(u,m) = b(m) + θᵀφ + pᵀq + δ in blueprint §7.1 — the collaborative (pᵀq) and per-user-exception (δ) terms join later, once enough data exists, per §7.1.

## Support

- **Issues**: Open a GitHub issue
- **Questions**: Check [docs/](./docs/)
- **Architecture**: See [docs/architecture.md](./docs/architecture.md)
- **Database**: See [docs/schema.md](./docs/schema.md)
- **Privacy**: See [docs/privacy.md](./docs/privacy.md)

## What's Next?

1. Implement backend auth endpoints
2. Build frontend UI for ranking
3. Create film fingerprinting worker
4. Seed initial film catalog
5. Run the Alpha (80-150 users, blueprint §17.2) — 15-20 people is the earlier clickable-prototype cohort, not this stage
6. Measure model accuracy vs. baselines

Happy coding! 🎬
