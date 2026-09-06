import { IsNull, Not, SelectQueryBuilder } from 'typeorm';
import { Title } from '../../entities/title.entity';

// PUB-G1 (ADR-118, board 1D-7): the condition every public-facing read of
// `titles` -- search/starter/detail, recommendations, triads, direct UUID,
// and any write that first checks a title exists (state/watch-events) --
// will exclude a row until `publishedRevisionId` is set.
//
// **NOT WIRED INTO ANY CONSUMER YET.** Owner decision 2026-09-06 (PUB-G1
// scope review): today every title has `publishedRevisionId = NULL` (no
// title has ever been published), so importing this into a live read path
// now would empty the whole catalog everywhere at once. Wiring is deferred
// to board 1D-9 (manual publish with transaction-lock/expectedRevision/
// audit), done explicitly and separately -- do not import this from
// `titles.service.ts`/`recommendations.service.ts`/`triads.service.ts`/
// `user-title-state.service.ts`/`watch-events.service.ts` before then.
//
// Two shapes because this codebase's Title call sites are split between
// `Repository.find()`/`findOne()` (a plain `where` object) and
// `createQueryBuilder()` (needs its own `andWhere`); both must express the
// exact same condition so a title can never be visible through one path
// and hidden through another, once this is actually connected.

/** Spread into a `Repository.find()`/`findOne()` `where` object. */
export const PUBLISHED_TITLE_WHERE = { publishedRevisionId: Not(IsNull()) } as const;

/**
 * Applies the same condition to a QueryBuilder. `alias` must match whatever
 * the caller passed to `createQueryBuilder(alias)` for the `titles` table
 * (every current call site uses `'title'`, but this never hardcodes it).
 */
export function wherePublished<T extends Title>(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}."publishedRevisionId" IS NOT NULL`);
}
