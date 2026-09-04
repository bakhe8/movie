import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { Credit } from '../../entities/credit.entity';
import { Title } from '../../entities/title.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../../entities/title-fingerprint.type';
import { TOP_K, TriadPolicyService } from './triad-policy.service';

const V1 = [
  'pacing', 'rhythmVariance', 'ambiguity', 'psychologicalDepth', 'warmth', 'darkness', 'linearity',
  'dialogueDensity', 'actionIntensity', 'plotComplexity', 'visualComplexity', 'soundscapeComplexity', 'colorSaturation',
];

// `warmth` is dimension 4; everything else sits at 0.5 so a test can move one
// axis at a time.
function title(id: string, warmth: number, genres: string[] = ['Drama']): Title {
  const flat = Object.fromEntries(V1.map((dim) => [dim, dim === 'warmth' ? warmth : 0.5]));
  return {
    id,
    genres,
    fingerprint: {
      ...flat,
      v2: { features: Object.fromEntries(FINGERPRINT_V2_DIMENSIONS.map((d) => [d, 0.5])) },
      v3: { features: Object.fromEntries(FINGERPRINT_V3_DIMENSIONS.map((d) => [d, 0.5])) },
    },
  } as unknown as Title;
}

// A seeded generator: deterministic like a fixed stub, but it actually
// varies, so the sampler explores different triples the way it does live.
function seeded(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function snapshotWithUncertainOn(index: number): UserModelSnapshot {
  const standardErrors = Array.from({ length: 40 }, (_, position) => (position === index ? 5 : 0.01));
  return { posterior: { standardErrors } } as UserModelSnapshot;
}

describe('TriadPolicyService (adaptive-v1)', () => {
  let credits: { find: ReturnType<typeof vi.fn> };
  let service: TriadPolicyService;

  beforeEach(() => {
    credits = { find: vi.fn().mockResolvedValue([]) };
    service = new TriadPolicyService(credits as unknown as Repository<Credit>);
  });

  it('needs three candidates before it can choose at all', async () => {
    expect(await service.select([title('a', 0.1), title('b', 0.9)], null, new Set())).toBeNull();
  });

  // The uncertainty term (RANKING_ALGORITHM §9): spread along the dimension
  // the fit is least sure of is what makes a triad worth asking. The policy
  // samples from the top-K rather than taking the argmax (that is what makes
  // `selectionPropensity` meaningful), so this asserts the tendency it is
  // designed to have, not a guarantee it deliberately does not give.
  it('leans towards triads that spread the least certain dimension', async () => {
    const titles = [title('low', 0.0), title('mid', 0.5), title('high', 1.0), title('flat-a', 0.5), title('flat-b', 0.5), title('flat-c', 0.5)];
    const snapshot = snapshotWithUncertainOn(V1.indexOf('warmth'));

    let spread = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const selection = await service.select(titles, snapshot, new Set(), seeded(seed));
      const chosen = new Set(selection?.titleIds);
      // Any triad carrying both extremes moves warmth; three flat titles move nothing.
      if (chosen.has('low') && chosen.has('high')) {
        spread += 1;
      }
    }

    expect(spread).toBeGreaterThan(20);
  });

  it('reports the propensity of the top-K sample it actually drew from', async () => {
    const titles = Array.from({ length: 8 }, (_, index) => title(`t${index}`, index / 8));

    const selection = await service.select(titles, null, new Set(), seeded(5));

    expect(selection?.selectionPropensity).toBeCloseTo(1 / TOP_K);
  });

  // BP §8.3: a shared director makes the comparison circular.
  it('never offers two films by the same director', async () => {
    credits.find.mockResolvedValue([
      { titleId: 'a', personId: 'kurosawa' },
      { titleId: 'b', personId: 'kurosawa' },
    ] as Credit[]);
    const titles = [title('a', 0.1), title('b', 0.9), title('c', 0.5)];

    expect(await service.select(titles, null, new Set(), seeded(5))).toBeNull();
  });

  // With a pool this small (4 titles = 4 possible triples, all inside the
  // top-K) the policy is uniform by construction, so the penalty is measured
  // on a pool big enough for the ranking to bite.
  it('penalises repeating a title from the recent rounds', async () => {
    const titles = Array.from({ length: 10 }, (_, index) => title(`t${index}`, index / 10));

    let withSeen = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const selection = await service.select(titles, null, new Set(['t4']), seeded(seed));
      if (selection?.titleIds.includes('t4')) {
        withSeen += 1;
      }
    }

    // Chance alone would place a given title in 3 of 10 triads (~18 of 60).
    expect(withSeen).toBeLessThan(12);
  });

  // ADR-19: an undescribed title contributes nothing to the information
  // term -- it is never zero-filled, which would have made it look
  // maximally different from everything else and win every time.
  it('treats a title with no fingerprint as carrying no information rather than zero', async () => {
    const undescribed = { id: 'blank', genres: ['Drama'], fingerprint: null } as unknown as Title;
    const titles = [title('a', 0.0), title('b', 1.0), title('c', 0.5), undescribed];

    let withBlank = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const selection = await service.select(titles, null, new Set(), seeded(seed));
      if (selection?.titleIds.includes('blank')) {
        withBlank += 1;
      }
    }

    // Zero-filling would have made 'blank' the most "informative" title of
    // the four and pushed this to 40.
    expect(withBlank).toBeLessThan(35);
  });
});
