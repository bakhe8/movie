# Movie Recommendation System

A sophisticated PWA for personalized movie recommendations using triadic ranking, film fingerprinting, and statistically independent ranking weights.

> **Product foundation**: [docs/movie_taste_platform_blueprint_ar.md](docs/movie_taste_platform_blueprint_ar.md) (Arabic) is the authoritative product spec — vision, non-negotiable principles, UX, math, data, architecture, evaluation, privacy, and rollout gates. This README and the rest of `docs/` describe an earlier implementation pass; where they diverge from the blueprint (e.g. merged confidence scores, post-watch star ratings, fixed accuracy targets), the blueprint is the one to follow. Launch market is Arabic-first (Saudi/Gulf), RTL UI, English support built into the infrastructure from day one.

## Technology Stack

### Frontend
- **Next.js** (App Router) - PWA with TypeScript
- **Tailwind CSS** - Utility-first styling
- **React 18** - UI framework

### Backend
- **NestJS** - Modular backend framework
- **TypeScript** - Type-safe development
- **PostgreSQL** - Primary database with pgvector extension
- **Redis** - Caching and task queue

### Workers (Python)
- **NumPy/SciPy** - Statistical computation
- **Plackett-Luce Model** - Learning from triadic rankings
- **OpenAI API** - Film fingerprint generation
- **PostgreSQL** - Data persistence

### Infrastructure
- **Docker & Docker Compose** - Local development
- **pnpm** (or npm) - Node.js package management

## Project Structure

```
movie/
├── apps/
│   ├── frontend/           # Next.js PWA
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   └── backend/            # NestJS API
│       ├── src/
│       │   ├── entities/   # Database models
│       │   ├── modules/    # Feature modules
│       │   ├── config/     # Configuration
│       │   └── main.ts     # Entry point
│       └── package.json
├── services/
│   └── workers/            # Python ranking & enrichment
│       ├── src/
│       │   ├── ranker.py   # Plackett-Luce implementation
│       │   ├── enrichment.py  # OpenAI fingerprinting
│       │   └── __init__.py
│       └── pyproject.toml
├── packages/
│   └── shared/             # Shared TypeScript types
│       ├── src/
│       │   ├── types.ts    # Core interfaces
│       │   └── index.ts
│       └── package.json
├── docker/                 # Docker configuration
│   └── docker-compose.yml  # PostgreSQL + Redis
├── .env.example            # Environment template
├── package.json            # Root workspace
├── tsconfig.json           # Root TypeScript config
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 22+ and npm 10+
- Python 3.11+
- Docker & Docker Compose
- OpenAI API key (for film fingerprinting)

### 1. Setup Environment
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# IMPORTANT: Add your OpenAI API key for fingerprinting
```

### 2. Start Infrastructure
```bash
# Start PostgreSQL (with pgvector) and Redis
npm run docker:up

# Verify services are running
docker ps
```

### 3. Install Dependencies
```bash
# Install all workspace dependencies
npm install

# Or with pnpm
pnpm install
```

### 4. Database Setup
```bash
# Run migrations (when implemented)
npm run db:migrate

# Seed initial films (when implemented)
npm run db:seed
```

### 5. Development Mode
```bash
# Start frontend and backend concurrently
npm run dev

# Frontend: http://localhost:3000
# Backend: http://localhost:3101
```

## Database Schema (Phase 1)

### Core Tables
- **users** - User accounts and profiles
- **profiles** - Individual user taste profiles
- **titles** - Film catalog with metadata
- **triads** - Triadic ranking comparisons
- **embeddings** - pgvector embeddings for films
- **recommendations** - Generated recommendations

See [docs/schema.md](docs/schema.md) for detailed schema.

## Film Fingerprint Schema (V1)

Each film is analyzed across multiple semantic dimensions spanning the families in blueprint §6.1 (narrative, pacing, tone/emotion, characters, dialogue, style, theme, ending, people, cultural context) — the blueprint does not fix a total dimension count, so treat "~30-50" as this repo's own unverified draft, not a blueprint decision:

```typescript
{
  pacing: 0.6,              // Slow (0) to Fast (1)
  ambiguity: 0.8,           // Clear (0) to Ambiguous (1)
  psychologicalDepth: 0.9,  // Shallow to Deep
  warmth: 0.2,              // Cold to Warm
  dialogueDensity: 0.5,     // Sparse to Dense
  // ... and more dimensions
  themes: ["identity", "memory", "loss"],
  confidence: {
    pacing: 0.85,
    ambiguity: 0.92,
    // ... confidence scores
  }
}
```

## Ranking Engine

### Plackett-Luce Model
The system learns user preferences using the full utility model from blueprint §7.1 (this README previously showed a truncated version missing the population prior — fixed here to match):

$$s(u,m) = b(m) + \theta_u^{\top}\phi_m + p_u^{\top}q_m + \delta_{u,m}$$

Where:
- $b(m)$ = weak population prior / general quality, heavily shrunk and kept visually separate from Personal Fit
- $\phi_m$ = film fingerprint (feature vector), $\theta_u$ = user's interpretable taste weights
- $p_u^{\top}q_m$ = collaborative signal, only added once enough data exists — not used early (blueprint §7.1)
- $\delta_{u,m}$ = this user's exceptional-film residual, heavily shrunk so it doesn't generalize (blueprint §7.4)

**Training:** Complete rankings from triadic comparisons using maximum likelihood estimation, treating each A>B>C ranking as one listwise Plackett–Luce event rather than three independent pairwise comparisons (blueprint §7.2).

**Evaluation:** Pairwise comparison accuracy on held-out triads.

## Core Components

### Frontend (Phase 1)
- [ ] User authentication (signup/login)
- [ ] Individual profile creation
- [ ] Film search and discovery
- [ ] Triadic ranking interface (3 cards, click to rank)
- [ ] Replacement for "haven't watched" and "don't remember it well" — two distinct neutral states, neither a preference signal (blueprint §2.4 principle #3, §4.3)
- [ ] Initial recommendations display
- [ ] Admin dashboard for model inspection

### Backend (Phase 1)
- [ ] REST API with NestJS
- [ ] User and profile management
- [ ] Film CRUD and search
- [ ] Triad generation and storage
- [ ] Ranking model endpoints
- [ ] Recommendation generation
- [ ] Admin endpoints for model monitoring

### Workers (Phase 1)
- [ ] Film fingerprint generation (OpenAI Responses API)
- [ ] Plackett-Luce model training
- [ ] Embedding generation (pgvector)
- [ ] Background job processing (Redis + BullMQ)

## OpenAI Integration

### Fingerprinting (Async Background Job)
```python
fingerprint = enrichment_worker.generate_fingerprint(
    title="Inception",
    description="...",
    plot_summary="..."
)
# Stores to DB with model version, confidence scores
```

### Recommendation Explanations
```python
explanation = enrichment_worker.generate_recommendation_explanation(
    user_preferences=weights,
    recommended_title="Interstellar",
    fingerprint=film_fingerprint,
    similar_titles=["Inception", "The Prestige"]
)
```

**Never use OpenAI for ranking decisions** - the model explains, not decides.

## Data Privacy & Compliance

- ✅ Individual profiles (no family accounts)
- ✅ Preference data isolation per user
- ✅ Event-based storage (rebuild from events)
- ✅ User controls: download, delete, reset
- ✅ Audit trails for all API calls
- ✅ Saudi Arabia PDPL compliance features

See [docs/privacy.md](docs/privacy.md) for details.

## Development Workflow

### Add a Feature
```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Development with hot reload
npm run dev

# 3. Run tests
npm run test

# 4. Lint and format
npm run lint

# 5. Build for production
npm run build

# 6. Deploy (see deployment docs)
```

### Testing
```bash
# Frontend tests
npm run test -w apps/frontend

# Backend tests
npm run test -w apps/backend

# Worker tests (Python)
cd services/workers && pytest
```

## Deployment

### Development
- Local Docker stack with npm dev server

### Staging
- AWS/GCP managed PostgreSQL
- Redis cluster
- Next.js on Vercel or Lambda
- NestJS on Lambda or EC2
- Python workers on Lambda/Fargate

### Production
- Separate database for testing/prod
- API rate limiting and monitoring
- Cost controls for OpenAI API
- CDN for static assets
- Automated backups

See [docs/deployment.md](docs/deployment.md) for CI/CD setup.

## Troubleshooting

### Database connection refused
```bash
# Check if PostgreSQL container is running
docker ps | grep postgres

# Restart services
npm run docker:down && npm run docker:up
```

### OpenAI API errors
- Verify `OPENAI_API_KEY` is set in `.env`
- Check API key is valid and has sufficient quota
- Ensure `store:false` is used for data privacy

### Node_modules issues
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

1. **Implement Phase 1 endpoints** - User auth, film CRUD, triad API
2. **Build frontend UI** - Triadic ranking interface
3. **Add fingerprinting worker** - OpenAI integration for first 300-500 films
4. **Phase 0 UX validation** - Clickable prototype, 15-20 people, UX/question validation only — not a beta and not real ranking-model data collection (blueprint §17.1)
5. **Alpha data collection** - 80-150 users; accepters complete 20-30 triads across short sessions (blueprint §17.2)
6. **Validate MVP hypothesis** - Prove Plackett-Luce > baselines, gated on the Alpha outcome, not a fixed accuracy promise (blueprint §16.5)
7. **Phase 2** - General model, native app only if PWA proves the need (blueprint §5.2), JustWatch-style availability integration

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Next.js Documentation](https://nextjs.org/docs)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [PostgreSQL pgvector](https://github.com/pgvector/pgvector)
- [Plackett-Luce Model Papers](https://en.wikipedia.org/wiki/Luce%27s_choice_axiom)

## License

MIT (see LICENSE file)

## Support

For questions or issues, please open a GitHub issue or contact the team.
