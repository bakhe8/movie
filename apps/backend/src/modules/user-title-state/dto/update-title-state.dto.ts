import { IsDateString, IsIn, IsOptional, MaxLength } from 'class-validator';
import { TitleState } from '../../../entities/user-title-state.entity';

// No `rating` field here on purpose. Per the blueprint (§2.4 principle #2, §4.5), the only
// explicit preference signal the product ever collects is a triad ranking — this endpoint
// must never double as an in-app star-rating prompt. An imported rating (from a future
// list-import feature) is written through its own path directly onto UserTitleState.importedRating
// with ratingSource: 'import', never through this general state-update DTO.
export class UpdateTitleStateDto {
  @IsIn(['watched', 'not_watched', 'watchlist', 'interested'])
  state: TitleState;

  @IsOptional()
  @IsDateString()
  watchedAt?: string;

  // Omitted entirely -> existing notes are left alone (PATCH semantics, M1).
  // Sent as `null` -> notes are explicitly cleared.
  @IsOptional()
  @MaxLength(1000)
  notes?: string | null;
}