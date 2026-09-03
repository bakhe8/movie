import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { SourceRecordLicenseStatus, SourceRecordReviewStatus } from '../../../entities/source-record.entity';

export const LICENSE_STATUSES = ['commercial_allowed', 'non_commercial_only', 'pending_review', 'unknown'] as const;
export const REVIEW_STATUSES = ['unreviewed', 'sampled', 'human_verified'] as const;

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}

export class ListTitlesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  // 'fingerprint' = no published fingerprint at all; 'v2' = V1 only;
  // 'license' = no source_records row, or every row is 'unknown'.
  @IsOptional()
  @IsIn(['fingerprint', 'v2', 'license'])
  missing?: 'fingerprint' | 'v2' | 'license';
}

export class ExternalIdsDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  imdb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tmdb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  wikidata?: string;
}

// Source data is corrected here (PRIVACY.md §5 "correction ... via admin");
// the fingerprint itself is never edited on this route -- a feature value is
// corrected through the review queue, which supersedes the old row.
export class UpdateTitleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1888)
  @Max(2100)
  releaseYear?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  genres?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  originalLanguage?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalIdsDto)
  externalIds?: ExternalIdsDto;
}

// One rights-registry row (BP §11.1, DATA_LICENSING.md §1): which field of
// the title came from where, under what terms.
export class CreateSourceRecordDto {
  @IsString()
  @MaxLength(100)
  fieldName: string;

  @IsString()
  @MaxLength(200)
  source: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  license?: string;

  @IsIn(LICENSE_STATUSES)
  licenseStatus: SourceRecordLicenseStatus;

  @IsOptional()
  @IsBoolean()
  allowsStorage?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsDerivation?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsTraining?: boolean;

  @IsOptional()
  @IsBoolean()
  attributionRequired?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fallbackPlan?: string;

  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  reviewStatus?: SourceRecordReviewStatus;
}

export class UpdateSourceRecordDto {
  @IsOptional()
  @IsIn(LICENSE_STATUSES)
  licenseStatus?: SourceRecordLicenseStatus;

  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  reviewStatus?: SourceRecordReviewStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  license?: string;

  @IsOptional()
  @IsBoolean()
  allowsStorage?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsDerivation?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsTraining?: boolean;

  @IsOptional()
  @IsBoolean()
  attributionRequired?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fallbackPlan?: string;
}

export class ListContentFeaturesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  reviewStatus?: (typeof REVIEW_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  titleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  featureKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  extractorVersion?: string;
}

export class SampleContentFeaturesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  extractorVersion?: string;
}

// BP §15.4 sample review. A corrected value never edits the row in place:
// it becomes a new human-review row that supersedes the extracted one.
export class ReviewContentFeatureDto {
  @IsIn(REVIEW_STATUSES)
  reviewStatus: (typeof REVIEW_STATUSES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  correctedValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateModelVersionDto {
  @IsString()
  @MaxLength(100)
  version: string;

  @IsString()
  @MaxLength(100)
  rankerType: string;

  @IsString()
  @MaxLength(100)
  fingerprintSchemaVersion: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  codeRef?: string;

  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  thresholds?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  evalReport?: Record<string, unknown>;
}

export class UpdateModelVersionDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsObject()
  evalReport?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  thresholds?: Record<string, unknown>;
}

export class ListUsersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListPrivacyRequestsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['export', 'delete', 'reset'])
  type?: 'export' | 'delete' | 'reset';

  @IsOptional()
  @IsIn(['requested', 'verifying', 'scheduled', 'running', 'done', 'cancelled'])
  status?: string;
}

export class ListAuditLogQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resource?: string;

  @IsOptional()
  @IsUUID()
  resourceId?: string;
}

export class LatestTriadsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}

// The metrics window. `days` back from now is the common case; explicit
// `from`/`to` (ISO-8601) override it. `excludeDomains` keeps demo and judge
// accounts out of the numbers.
export class MetricsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3660)
  days: number = 30;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((d: string) => d.trim().toLowerCase())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  excludeDomains: string[] = [];
}
