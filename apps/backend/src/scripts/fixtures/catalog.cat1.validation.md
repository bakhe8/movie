# CAT-1 — Local validation

Base commit: `378c152` (the fetched `origin/main` at start). Branch: `codex/cat1-identity-425`. Checked 2026-09-06.

**Identity guards PASS; 425 admission BLOCKED.** The fixture and dedicated database contain 389 works: all 384 baseline objects are unchanged, plus five sourced additions. Thirty-six original candidate rows remain excluded; none was substituted. CAT-2 was not started.

| Check | Result |
|---|---|
| Backend TypeScript build | PASS |
| Targeted ESLint (identity, builder, importer, entity, migration, tests) | PASS |
| `catalog-identity.spec.ts` + `seed-demo.lib.spec.ts` | 39 PASS |
| `catalog-identity.e2e-spec.ts` + `seed-demo.e2e-spec.ts` | 10 PASS |
| Full catalog build (cached source facts, reviewed Arabic overrides) | 389/425; exit 1 for 36 missing Arabic titles |
| Fresh dedicated PostgreSQL migrations | 38 applied, including identity guards |
| Seed + reseed | PASS; same UUID and external IDs per work |
| SQL readback | 389 rows; 0 internalId/Wikidata/IMDb/TMDB collision groups |
| Legacy rebind before seed side effects | Rejected; title rows/timestamps and accounts unchanged |
| Direct DB duplicates / rebind / malformed IDs / concurrent collision | Rejected; exactly one concurrent insert succeeds |
| Existing data preservation | All 384 fixture objects equal base; enrichment and artwork preserved |
| Remake / edition distinction | Separate provider IDs accepted despite same title; dub/cut rows share one title via `title_editions` |

Readback counters and hashes: [validation JSON](catalog.cat1.validation.json). Source outcomes and exact names: [Arabic review](catalog.demo.ar-review.json). Separate unresolved worklist: [36 blockers](catalog.cat1.blockers.md).

The five new works retain unknown fingerprint/artwork values; no enrichment or poster was invented. Metadata outside the five additions was not refreshed. Wikidata responses used by the builder remain cached; the separate Arabic-label review queried all 41 candidate items live.

Reproduce from `apps/backend`: `npm run build`; `npm run test -- src/scripts/catalog-identity.spec.ts src/scripts/seed-demo.lib.spec.ts`; migrate an explicitly selected disposable `*_test` database, then `npx vitest run -c vitest.e2e.config.ts test/catalog-identity.e2e-spec.ts test/seed-demo.e2e-spec.ts`. Run `npm run catalog:fetch` to reproduce the incomplete 425 gate; it must exit 1 until the same 36 works have verified Arabic titles.

Database used: isolated container `movie-cat1-postgres-test`, loopback port 55439, database `moviedb_test`; no shared development or production database, GitHub Actions, push or PR. The container and task-owned temporary outputs are removed after verification; the committed reports preserve the evidence.
