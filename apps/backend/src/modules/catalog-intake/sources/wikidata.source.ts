import type { CatalogSourceAdapter, DiscoveredCandidate, DiscoveryCriteria, ResolveOutcome, SourceRunContext } from './catalog-source';
import { SourceHttp } from './source-http';
import {
  WD_P,
  buildDiscoverySparql,
  claimIds,
  entitiesUrl,
  factsFromEntity,
  parseDiscoveryBindings,
  parseWikipediaLead,
  referencedLookup,
  sparqlUrl,
  wikipediaLeadUrl,
  type SparqlResponse,
  type WdEntitiesResponse,
  type WdEntity,
  type WikiPagePropsResponse,
} from './wikidata.lib';

export const WIKIDATA_SOURCE_KEY = 'wikidata';
const ENTITY_BATCH = 50;

// CAT-J1 (ADR-121): the first adapter. Wikidata is CC0 and the identity
// spine (P345 IMDb, P4947 TMDB) every other source hangs off, so it is both
// the discovery source and the primary fact source. Wikipedia leads (CC
// BY-SA) supply the description exactly as fetch-catalog.ts does for the
// fixture. Official APIs only -- SPARQL, wbgetentities, the action API --
// never a page scrape (DATA_LICENSING.md §7).
export class WikidataSource implements CatalogSourceAdapter {
  readonly key = WIKIDATA_SOURCE_KEY;

  constructor(
    private readonly http: SourceHttp = new SourceHttp(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async discover(criteria: DiscoveryCriteria, ctx: SourceRunContext): Promise<DiscoveredCandidate[]> {
    const query = buildDiscoverySparql(criteria);
    await ctx.heartbeat(0, 1);
    const response = await this.http.getJson<SparqlResponse>(sparqlUrl(query), { Accept: 'application/sparql-results+json' });
    await ctx.heartbeat(1, 1);
    return response ? parseDiscoveryBindings(response, criteria, this.key) : [];
  }

  async resolveMany(wikidataIds: readonly string[], ctx: SourceRunContext): Promise<Map<string, ResolveOutcome>> {
    const outcomes = new Map<string, ResolveOutcome>();
    const ids = [...new Set(wikidataIds)];
    const total = ids.length;
    let done = 0;

    for (let start = 0; start < ids.length; start += ENTITY_BATCH) {
      if (await ctx.isCancelled()) break;
      const batch = ids.slice(start, start + ENTITY_BATCH);
      let entities: Record<string, WdEntity>;
      try {
        const response = await this.http.getJson<WdEntitiesResponse>(entitiesUrl(batch, 'labels|descriptions|claims|sitelinks', 'en|ar', 'enwiki|arwiki'));
        entities = response?.entities ?? {};
      } catch (error) {
        for (const id of batch) outcomes.set(id, { ok: false, error: describe(error) });
        done += batch.length;
        await ctx.heartbeat(done, total);
        continue;
      }

      // Genre / language / country items, labelled in one extra call per batch.
      const referencedIds = new Set<string>();
      for (const entity of Object.values(entities)) {
        for (const property of [WD_P.genre, WD_P.originalLanguage, WD_P.country]) {
          claimIds(entity, property).forEach((id) => referencedIds.add(id));
        }
      }
      let referenced: Record<string, WdEntity> = {};
      if (referencedIds.size > 0) {
        try {
          const refIds = [...referencedIds];
          for (let refStart = 0; refStart < refIds.length; refStart += ENTITY_BATCH) {
            const response = await this.http.getJson<WdEntitiesResponse>(entitiesUrl(refIds.slice(refStart, refStart + ENTITY_BATCH), 'labels|claims', 'en'));
            referenced = { ...referenced, ...(response?.entities ?? {}) };
          }
        } catch (error) {
          // Labels are needed to map genres and languages; without them the
          // facts would be wrong, not merely thin -- so the whole batch is a
          // fetch failure and is retried on the next run.
          for (const id of batch) outcomes.set(id, { ok: false, error: describe(error) });
          done += batch.length;
          await ctx.heartbeat(done, total);
          continue;
        }
      }
      const lookup = referencedLookup(referenced);

      for (const id of batch) {
        if (await ctx.isCancelled()) break;
        const entity = entities[id];
        if (!entity || entity.missing !== undefined) {
          outcomes.set(id, { ok: false, error: `wikidata-missing: entity ${id} not returned` });
          done += 1;
          continue;
        }
        try {
          const leads = await this.leadsFor(entity);
          outcomes.set(id, { ok: true, facts: factsFromEntity(entity, lookup, leads, this.now()) });
        } catch (error) {
          outcomes.set(id, { ok: false, error: describe(error) });
        }
        done += 1;
        await ctx.heartbeat(done, total);
      }
    }
    return outcomes;
  }

  private async leadsFor(entity: WdEntity): Promise<{ en?: string | null; ar?: string | null }> {
    const leads: { en?: string | null; ar?: string | null } = {};
    const en = entity.sitelinks?.enwiki?.title;
    const ar = entity.sitelinks?.arwiki?.title;
    if (en) leads.en = parseWikipediaLead(await this.http.getJson<WikiPagePropsResponse>(wikipediaLeadUrl('en', en)), entity.id);
    if (ar) leads.ar = parseWikipediaLead(await this.http.getJson<WikiPagePropsResponse>(wikipediaLeadUrl('ar', ar)), entity.id);
    return leads;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
