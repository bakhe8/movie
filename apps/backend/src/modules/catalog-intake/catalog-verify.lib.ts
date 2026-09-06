import { ID_PROVIDERS, type CatalogIdentity } from '../../scripts/catalog-identity';
import type { Dev1000Record } from '../../scripts/catalog-dev1000.lib';
import { INTAKE_EVALUATOR_VERSION, evaluateIntake, type IntakeBlockerCode } from './intake-evaluator';

// CAT-J1 / J1a (ADR-121): the `catalog_verify` report, pure. Runs the
// `intake-v1` completeness rules over what is already admitted in `titles`
// (read-only -- this never writes), and reconciles the admitted set against
// the reserved identities in `catalog.demo.identity.json` and the dev1000
// staging record, so an operator sees in one place: which reserved works are
// not admitted yet, whether any admitted binding differs from its
// reservation (which the database trigger forbids, so a hit here means the
// fixture drifted, not the database), and which rights rows are missing.

export interface VerifyTitleRow {
  id: string;
  internalId: string;
  titleEn: string | null;
  titleAr: string | null;
  description: string | null;
  releaseYear: number | null;
  genres: string[] | null;
  posterPath: string | null;
  externalIds: { wikidata?: string; imdb?: string; tmdb?: string } | null;
  fingerprint: Record<string, unknown> | null;
}

export interface VerifySourceRecordRow {
  titleId: string | null;
  fieldName: string;
  source: string;
  retentionUntil: Date | null;
}

export const RIGHTS_FIELDS = ['titleEn', 'titleAr', 'releaseYear', 'genres', 'description', 'posterPath'] as const;

export interface BindingMismatch {
  internalId: string;
  provider: (typeof ID_PROVIDERS)[number];
  reserved: string | null;
  admitted: string | null;
}

export interface CatalogVerifyReport {
  evaluatorVersion: typeof INTAKE_EVALUATOR_VERSION;
  titlesExamined: number;
  admissible: number;
  blocked: number;
  byCode: Partial<Record<IntakeBlockerCode, number>>;
  reservation: {
    reserved: number;
    admitted: number;
    reservedNotAdmitted: string[];
    admittedNotReserved: string[];
    bindingMismatches: BindingMismatch[];
  };
  staging: {
    records: number;
    byDevStatus: Record<string, number>;
    /** Staged records (any devStatus) whose provider ids are already admitted -- the pipeline moved them, or a collision to look at. */
    stagedAlreadyAdmitted: string[];
  } | null;
  provenance: {
    titlesWithoutAnyRow: number;
    /** Titles with a value in this field but no `source_records` row citing it (hygiene debt, DATA_LICENSING.md §0). */
    fieldsWithoutRow: Record<string, number>;
    titlesWithExpiredRights: number;
  };
  /** Up to `sampleLimit` blocked titles with their codes, worst first. */
  sample: { internalId: string; blockerCodes: IntakeBlockerCode[] }[];
}

export interface VerifyInput {
  titles: readonly VerifyTitleRow[];
  sourceRecords: readonly VerifySourceRecordRow[];
  reserved: readonly CatalogIdentity[];
  staging?: readonly Dev1000Record[] | null;
  now?: Date;
  sampleLimit?: number;
}

function hasFingerprintV2(fingerprint: Record<string, unknown> | null): boolean {
  return !!fingerprint && typeof fingerprint === 'object' && fingerprint.v2 !== null && fingerprint.v2 !== undefined;
}

export function verifyCatalog(input: VerifyInput): CatalogVerifyReport {
  const now = input.now ?? new Date();
  const sampleLimit = input.sampleLimit ?? 25;
  const byCode: Partial<Record<IntakeBlockerCode, number>> = {};
  const sample: CatalogVerifyReport['sample'] = [];
  let admissible = 0;

  const rowsByTitle = new Map<string, VerifySourceRecordRow[]>();
  for (const row of input.sourceRecords) {
    if (!row.titleId) continue;
    const bucket = rowsByTitle.get(row.titleId);
    if (bucket) bucket.push(row);
    else rowsByTitle.set(row.titleId, [row]);
  }

  let titlesWithoutAnyRow = 0;
  let titlesWithExpiredRights = 0;
  const fieldsWithoutRow: Record<string, number> = {};

  for (const title of input.titles) {
    const evaluation = evaluateIntake({
      wikidataId: title.externalIds?.wikidata ?? null,
      imdbId: title.externalIds?.imdb ?? null,
      tmdbId: title.externalIds?.tmdb ?? null,
      titleEn: title.titleEn,
      titleAr: title.titleAr,
      description: title.description,
      releaseYear: title.releaseYear,
      genres: title.genres,
      posterPath: title.posterPath,
      fingerprintPresent: hasFingerprintV2(title.fingerprint),
    });
    for (const code of evaluation.blockerCodes) byCode[code] = (byCode[code] ?? 0) + 1;
    if (evaluation.admissible) admissible += 1;
    else if (sample.length < sampleLimit) sample.push({ internalId: title.internalId, blockerCodes: evaluation.blockerCodes });

    const rows = rowsByTitle.get(title.id) ?? [];
    if (rows.length === 0) titlesWithoutAnyRow += 1;
    if (rows.some((row) => row.retentionUntil !== null && row.retentionUntil.getTime() < now.getTime())) titlesWithExpiredRights += 1;
    const cited = new Set(rows.map((row) => row.fieldName));
    for (const field of RIGHTS_FIELDS) {
      const value = title[field];
      const present = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
      if (present && !cited.has(field)) fieldsWithoutRow[field] = (fieldsWithoutRow[field] ?? 0) + 1;
    }
  }

  // Reservation reconciliation (ADR-116): every admitted work must be a
  // reserved one with identical bindings; a reserved work may be not admitted yet.
  const admittedById = new Map(input.titles.map((title) => [title.internalId, title]));
  const reservedIds = new Set(input.reserved.map((row) => row.internalId));
  const reservedNotAdmitted = input.reserved.filter((row) => !admittedById.has(row.internalId)).map((row) => row.internalId);
  const admittedNotReserved = input.titles.filter((title) => !reservedIds.has(title.internalId)).map((title) => title.internalId);
  const bindingMismatches: BindingMismatch[] = [];
  for (const reservation of input.reserved) {
    const title = admittedById.get(reservation.internalId);
    if (!title) continue;
    for (const provider of ID_PROVIDERS) {
      const reserved = reservation.externalIds?.[provider] ?? null;
      const admitted = title.externalIds?.[provider] ?? null;
      // A provider id added in the database but absent from the reservation
      // is a reservation gap; a different value is a rebind. Both are listed.
      if (reserved !== admitted) bindingMismatches.push({ internalId: reservation.internalId, provider, reserved, admitted });
    }
  }

  let staging: CatalogVerifyReport['staging'] = null;
  if (input.staging) {
    const byDevStatus: Record<string, number> = {};
    const admittedProviderKeys = new Set<string>();
    for (const title of input.titles) {
      for (const provider of ID_PROVIDERS) {
        const value = title.externalIds?.[provider];
        if (value) admittedProviderKeys.add(`${provider}:${value}`);
      }
    }
    const stagedAlreadyAdmitted: string[] = [];
    for (const record of input.staging) {
      byDevStatus[record.devStatus] = (byDevStatus[record.devStatus] ?? 0) + 1;
      if (admittedById.has(record.internalId)) continue; // the 389 baseline itself
      const collides = ID_PROVIDERS.some((provider) => {
        const value = record.externalIds?.[provider];
        return value ? admittedProviderKeys.has(`${provider}:${value}`) : false;
      });
      if (collides) stagedAlreadyAdmitted.push(record.internalId);
    }
    staging = { records: input.staging.length, byDevStatus, stagedAlreadyAdmitted };
  }

  return {
    evaluatorVersion: INTAKE_EVALUATOR_VERSION,
    titlesExamined: input.titles.length,
    admissible,
    blocked: input.titles.length - admissible,
    byCode,
    reservation: {
      reserved: input.reserved.length,
      admitted: input.titles.length,
      reservedNotAdmitted,
      admittedNotReserved,
      bindingMismatches,
    },
    staging,
    provenance: { titlesWithoutAnyRow, fieldsWithoutRow, titlesWithExpiredRights },
    sample,
  };
}
