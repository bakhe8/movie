import type { IntakeProvenance } from '../../../entities/catalog-intake.entity';

// CAT-J1 (ADR-121): the one contract every catalog source speaks. An adapter
// offers facts *with their provenance* and nothing else -- it never decides
// identity (the evaluator's cross-source check does), never picks which
// source wins a field (a versioned field policy will), and never writes.
// DATA_LICENSING.md §2/§7 bound what an adapter may be: an official API or
// dataset, never a scrape; each adapter states the rights its values carry
// so the evaluator can keep, for example, TMDB text out of fingerprint
// derivation (TMDB's AI/ML clause) without knowing TMDB's terms itself.

export interface DiscoveryCriteria {
  /** Wikidata QIDs of production countries (P495) to search within. */
  countryQids?: string[];
  yearFrom?: number;
  yearTo?: number;
  /** Floor on `wikibase:sitelinks`, a rough notability proxy (CAT-2 used 6). */
  minSitelinks?: number;
  /** Original-language labels (lower-case) to drop, e.g. `['english']` -- CAT-2's tax-credit-Hollywood filter. */
  excludeOriginalLanguages?: string[];
  limit?: number;
  /** Free-text tags recorded on every candidate this run finds, for the reviewer. */
  slice?: string;
  reason?: string;
}

export interface DiscoveredCandidate {
  source: string;
  wikidataId: string | null;
  imdbId: string | null;
  tmdbId: string | null;
  titleEn: string | null;
  year: number | null;
  sitelinks: number | null;
  originalLanguageLabel: string | null;
  criteria: Record<string, unknown>;
}

export interface SourceFact<T> {
  value: T;
  provenance: IntakeProvenance;
}

export interface ResolvedFacts {
  wikidataId: string | null;
  imdbId: string | null;
  tmdbId: string | null;
  titleEn: SourceFact<string> | null;
  /** From a Wikidata label, an arwiki page title, or nothing -- never transliterated. */
  titleAr: SourceFact<string> | null;
  description: SourceFact<string> | null;
  /** True when `description` is only Wikidata's stub ("1958 film"). */
  descriptionIsStub: boolean;
  descriptionAr: SourceFact<string> | null;
  releaseYear: SourceFact<number> | null;
  genres: SourceFact<string[]> | null;
  unmappedGenres: string[];
  originalLanguage: SourceFact<string> | null;
  countries: SourceFact<string[]> | null;
  /** P31 within the film classes; null when the entity had no P31 at all. */
  isFilm: boolean | null;
  /** Wikidata's own English label when it differs from the discovered title -- evidence, not a replacement. */
  labelEn: string | null;
  warnings: string[];
}

export type ResolveOutcome = { ok: true; facts: ResolvedFacts } | { ok: false; error: string };

export interface SourceRunContext {
  isCancelled: () => Promise<boolean>;
  /** Called between network calls so the job's lease stays alive (admin_jobs' 5-minute lease is on `updatedAt`). */
  heartbeat: (done: number, total: number) => Promise<void>;
}

export interface CatalogSourceAdapter {
  readonly key: string;
  discover(criteria: DiscoveryCriteria, ctx: SourceRunContext): Promise<DiscoveredCandidate[]>;
  /** Resolve by Wikidata id (the identity spine every current source shares). */
  resolveMany(wikidataIds: readonly string[], ctx: SourceRunContext): Promise<Map<string, ResolveOutcome>>;
}
