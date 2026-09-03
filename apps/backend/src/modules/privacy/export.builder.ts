import { EntityManager, In } from 'typeorm';
import { Consent } from '../../entities/consent.entity';
import { Outcome } from '../../entities/outcome.entity';
import { PrivacyRequest } from '../../entities/privacy-request.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { FINGERPRINT_V2_DIMENSIONS } from '../../entities/title-fingerprint.type';
import { Triad } from '../../entities/triad.entity';
import { TriadReplacement } from '../../entities/triad-replacement.entity';
import { User } from '../../entities/user.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { WatchEvent } from '../../entities/watch-event.entity';

export const EXPORT_FORMAT = 'movie-export-v1';

// Mirrors RecommendationsService's FINGERPRINT_DIMENSIONS (V1 first, then
// V2) -- keep in sync by hand, the same rule as training.py. Only used to
// label snapshot weights in the export ("weights per feature key",
// PRIVACY.md §5); a snapshot whose length differs is exported unlabelled.
const FINGERPRINT_V1_DIMENSIONS = [
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
const FEATURE_KEYS: readonly string[] = [...FINGERPRINT_V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS];

export interface ExportDocument {
  meta: { format: string; exportedAt: string; requestId: string };
  account: { id: string; email: string; firstName: string | null; lastName: string | null; createdAt: Date };
  consents: Consent[];
  profiles: ExportedProfile[];
  privacyRequests: PrivacyRequest[];
}

export interface ExportedProfile {
  profile: Profile;
  titleStates: Array<Omit<UserTitleState, 'profile' | 'title'> & { title: TitleRef | null }>;
  triads: Array<Triad & { replacements: TriadReplacement[] }>;
  modelSnapshots: Array<Omit<UserModelSnapshot, 'profile' | 'sharedLatentSpaceVersion' | 'weights'> & {
    weights: Record<string, number> | number[];
  }>;
  recommendations: Array<Recommendation & { outcomes: Outcome[] }>;
  watchEvents: WatchEvent[];
}

interface TitleRef {
  id: string;
  internalId: string;
  titleEn: string;
  titleAr: string;
}

function titleRef(title: { id: string; internalId: string; titleEn: string; titleAr: string } | null | undefined): TitleRef | null {
  return title ? { id: title.id, internalId: title.internalId, titleEn: title.titleEn, titleAr: title.titleAr } : null;
}

function labelWeights(weights: number[]): Record<string, number> | number[] {
  if (weights.length !== FEATURE_KEYS.length) {
    return weights;
  }
  return Object.fromEntries(FEATURE_KEYS.map((key, index) => [key, weights[index]]));
}

// Everything the product holds about one account, as plain rows (BP §14
// "portable copy"; PRIVACY.md §5 lists the sections). Read-only; the caller
// owns the transaction, the request row and the audit entry.
export async function buildExport(manager: EntityManager, user: User, requestId: string): Promise<ExportDocument> {
  const profiles = await manager.find(Profile, { where: { userId: user.id }, order: { createdAt: 'ASC' } });
  const exportedProfiles: ExportedProfile[] = [];

  for (const profile of profiles) {
    const states = await manager.find(UserTitleState, { where: { profileId: profile.id }, relations: { title: true } });
    const triads = await manager.find(Triad, { where: { profileId: profile.id }, order: { createdAt: 'ASC' } });
    const replacements = triads.length
      ? await manager.find(TriadReplacement, { where: { triadId: In(triads.map((triad) => triad.id)) }, order: { createdAt: 'ASC' } })
      : [];
    const snapshots = await manager.find(UserModelSnapshot, { where: { profileId: profile.id }, order: { createdAt: 'ASC' } });
    const recommendations = await manager.find(Recommendation, { where: { profileId: profile.id }, order: { createdAt: 'ASC' } });
    const outcomes = recommendations.length
      ? await manager.find(Outcome, { where: { recommendationId: In(recommendations.map((r) => r.id)) }, order: { occurredAt: 'ASC' } })
      : [];
    const watchEvents = await manager.find(WatchEvent, { where: { profileId: profile.id }, order: { createdAt: 'ASC' } });

    exportedProfiles.push({
      profile,
      titleStates: states.map(({ title, profile: _profile, ...state }) => ({ ...state, title: titleRef(title) })),
      triads: triads.map((triad) => ({
        ...triad,
        replacements: replacements.filter((replacement) => replacement.triadId === triad.id),
      })),
      modelSnapshots: snapshots.map(({ weights, ...snapshot }) => ({ ...snapshot, weights: labelWeights(weights) })),
      recommendations: recommendations.map((recommendation) => ({
        ...recommendation,
        outcomes: outcomes.filter((outcome) => outcome.recommendationId === recommendation.id),
      })),
      watchEvents,
    });
  }

  return {
    meta: { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), requestId },
    account: {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      createdAt: user.createdAt,
    },
    consents: await manager.find(Consent, { where: { userId: user.id }, order: { grantedAt: 'ASC' } }),
    profiles: exportedProfiles,
    privacyRequests: await manager.find(PrivacyRequest, { where: { userId: user.id }, order: { requestedAt: 'ASC' } }),
  };
}
