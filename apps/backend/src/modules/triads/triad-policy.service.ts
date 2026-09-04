import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Credit } from '../../entities/credit.entity';
import { Title } from '../../entities/title.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../../entities/title-fingerprint.type';

export const ADAPTIVE_POLICY_VERSION = 'adaptive-v1';

// Mirrors the trainer's order exactly (ADR-69/75): weights and standard
// errors are positional arrays, so a different order here would silently
// score against the wrong dimension.
const V1_DIMENSIONS = [
  'pacing',
  'rhythmVariance',
  'ambiguity',
  'psychologicalDepth',
  'warmth',
  'darkness',
  'linearity',
  'dialogueDensity',
  'actionIntensity',
  'plotComplexity',
  'visualComplexity',
  'soundscapeComplexity',
  'colorSaturation',
] as const;
const DIMENSIONS = [...V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS, ...FINGERPRINT_V3_DIMENSIONS] as const;

// The policy samples from the top-K rather than always taking the argmax
// (RANKING_ALGORITHM §9), so `selectionPropensity` is a real 1/K and the
// log stays usable for off-policy evaluation (BP §8.2).
export const TOP_K = 5;
// How many random candidate triples to score. The exhaustive C(n,3) is
// 161,700 at n=100 -- sampling keeps selection O(1) in catalogue size while
// still choosing among genuinely different options.
const CANDIDATES_TO_SCORE = 120;
// Weights on the score's terms (BP §8.2's λ). Deliberately blunt: they are
// a starting point to be tuned against §16 evaluation, not tuned numbers.
const REPEAT_PENALTY = 0.5;
const GENRE_REPEAT_PENALTY = 0.3;

export interface TriadCandidate {
  titleIds: [string, string, string];
  score: number;
}

export interface AdaptiveSelection {
  titleIds: string[];
  selectionPropensity: number;
}

@Injectable()
export class TriadPolicyService {
  constructor(
    @InjectRepository(Credit)
    private readonly creditsRepository: Repository<Credit>,
  ) {}

  // Uncertainty targeting: a triad is informative when the titles differ
  // most along the dimensions this profile's own fit is least sure of --
  // standard errors from the trainer's Laplace approximation (ADR-62) are
  // the per-dimension uncertainty, and the spread across the three titles is
  // how much answering it can move that dimension. That is the practical
  // stand-in for §8.2's mutual-information term until a full posterior
  // exists. Minus the repetition costs §8.2 names (-λr·Repeat), and subject
  // to §8.3's constraint that one director may not supply two of the three.
  async select(
    titles: Title[],
    snapshot: UserModelSnapshot | null,
    recentTitleIds: Set<string>,
    random: () => number = Math.random,
  ): Promise<AdaptiveSelection | null> {
    if (titles.length < 3) {
      return null;
    }
    const directorByTitle = await this.directors(titles.map((title) => title.id));
    const vectors = new Map(titles.map((title) => [title.id, this.vector(title)]));
    const uncertainty = this.uncertainty(snapshot);

    const scored: TriadCandidate[] = [];
    const seen = new Set<string>();
    for (let attempt = 0; attempt < CANDIDATES_TO_SCORE; attempt += 1) {
      const triple = this.sampleTriple(titles, random);
      const key = [...triple.map((title) => title.id)].sort().join('|');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      // §8.3: no two films by the same director in one triad -- a shared
      // director makes the comparison circular rather than informative.
      if (this.sharesDirector(triple, directorByTitle)) {
        continue;
      }
      scored.push({
        titleIds: triple.map((title) => title.id) as [string, string, string],
        score: this.score(triple, vectors, uncertainty, recentTitleIds),
      });
    }
    if (scored.length === 0) {
      return null;
    }

    scored.sort((left, right) => right.score - left.score);
    const top = scored.slice(0, Math.min(TOP_K, scored.length));
    const chosen = top[Math.floor(random() * top.length)] ?? top[0];
    return { titleIds: [...chosen.titleIds], selectionPropensity: 1 / top.length };
  }

  private score(
    triple: Title[],
    vectors: Map<string, (number | null)[]>,
    uncertainty: number[],
    recentTitleIds: Set<string>,
  ): number {
    let information = 0;
    for (let index = 0; index < DIMENSIONS.length; index += 1) {
      const values = triple
        .map((title) => vectors.get(title.id)?.[index])
        .filter((value): value is number => typeof value === 'number');
      if (values.length < 2) {
        // An unknown dimension carries no information, and is never zero-filled (ADR-19).
        continue;
      }
      information += uncertainty[index] * (Math.max(...values) - Math.min(...values));
    }

    const repeats = triple.filter((title) => recentTitleIds.has(title.id)).length;
    const genres = triple.flatMap((title) => title.genres ?? []);
    const genreRepeat = genres.length - new Set(genres).size;
    return information - REPEAT_PENALTY * repeats - GENRE_REPEAT_PENALTY * genreRepeat;
  }

  // Standard errors when the snapshot has them; a flat 1 otherwise, which
  // reduces the term to plain spread -- still a sane "show different films"
  // signal before the first posterior exists.
  private uncertainty(snapshot: UserModelSnapshot | null): number[] {
    const standardErrors = snapshot?.posterior?.standardErrors;
    if (!standardErrors || standardErrors.length !== DIMENSIONS.length) {
      return DIMENSIONS.map(() => 1);
    }
    return standardErrors.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  }

  private vector(title: Title): (number | null)[] {
    const flat = title.fingerprint as unknown as Record<string, unknown> | null;
    const v2 = (title.fingerprint?.v2?.features ?? {}) as Record<string, number>;
    const v3 = (title.fingerprint?.v3?.features ?? {}) as Record<string, number>;
    return DIMENSIONS.map((dimension) => {
      const value = !dimension.includes('.')
        ? flat?.[dimension]
        : (FINGERPRINT_V3_DIMENSIONS as readonly string[]).includes(dimension)
          ? v3[dimension]
          : v2[dimension];
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    });
  }

  // Partial Fisher-Yates over an index list: always terminates, and never
  // depends on repeated draws happening to differ (a fixed `random` in a
  // test, or a degenerate RNG, would spin forever on reject-and-retry).
  private sampleTriple(titles: Title[], random: () => number): Title[] {
    const indices = titles.map((_, index) => index);
    for (let position = 0; position < 3; position += 1) {
      const swap = position + Math.floor(random() * (indices.length - position));
      const bounded = Math.min(swap, indices.length - 1);
      [indices[position], indices[bounded]] = [indices[bounded], indices[position]];
    }
    return indices.slice(0, 3).map((index) => titles[index]);
  }

  private sharesDirector(triple: Title[], directorByTitle: Map<string, Set<string>>): boolean {
    const seen = new Set<string>();
    for (const title of triple) {
      for (const personId of directorByTitle.get(title.id) ?? []) {
        if (seen.has(personId)) {
          return true;
        }
        seen.add(personId);
      }
    }
    return false;
  }

  private async directors(titleIds: string[]): Promise<Map<string, Set<string>>> {
    const credits = await this.creditsRepository.find({
      where: { titleId: In(titleIds), role: 'director' },
      select: { titleId: true, personId: true },
    });
    const byTitle = new Map<string, Set<string>>();
    for (const credit of credits) {
      const set = byTitle.get(credit.titleId) ?? new Set<string>();
      set.add(credit.personId);
      byTitle.set(credit.titleId, set);
    }
    return byTitle;
  }
}
