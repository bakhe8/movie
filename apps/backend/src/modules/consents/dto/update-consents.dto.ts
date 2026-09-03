import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ConsentPurpose } from '../../../entities/consent.entity';

// The two reserved-for-later purposes (email_recommendations,
// taste_card_sharing -- PRIVACY.md §3) are deliberately excluded: no feature
// exists yet to ask consent for, so accepting them now would record a grant
// for nothing.
const LIVE_CONSENT_PURPOSES = [
  'terms_privacy',
  'watch_history',
  'personalization_individual',
  'personalization_pooled',
  'import_processing',
  'analytics_first_party',
] as const;

export class ConsentGrantDto {
  @IsIn(LIVE_CONSENT_PURPOSES)
  purpose: ConsentPurpose;

  // The policy text version the user saw (SCHEMA.md §2.2) -- not validated
  // against a fixed list here, since the version string is expected to
  // change independently of this endpoint's own deploys.
  @IsString()
  @MaxLength(100)
  version: string;

  @IsBoolean()
  granted: boolean;
}

export class UpdateConsentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConsentGrantDto)
  consents: ConsentGrantDto[];
}
