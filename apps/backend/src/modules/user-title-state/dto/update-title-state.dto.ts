import { IsIn, IsOptional, Matches, MaxLength } from 'class-validator';
import { TitleState } from '../../../entities/user-title-state.entity';

// No `rating` field here on purpose. Per the blueprint (§2.4 principle #2, §4.5), the only
// explicit preference signal the product ever collects is a triad ranking — this endpoint
// must never double as an in-app star-rating prompt. An imported rating (from a future
// list-import feature) is written through its own path directly onto UserTitleState.importedRating
// with ratingSource: 'import', never through this general state-update DTO.
export class UpdateTitleStateDto {
  @IsIn(['watched', 'not_watched', 'watchlist', 'interested'])
  state: TitleState;

  // Plain 'YYYY-MM-DD', the caller's own calendar day (ADR-104) -- never a
  // timestamp, so no timezone conversion happens on either side of this
  // field. @IsDateString() would accept (and silently keep) a full ISO
  // instant, which is exactly the shape this replaces.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'watchedOn must be a plain YYYY-MM-DD date' })
  watchedOn?: string;

  // Omitted entirely -> existing notes are left alone (PATCH semantics, M1).
  // Sent as `null` -> notes are explicitly cleared.
  @IsOptional()
  @MaxLength(1000)
  notes?: string | null;
}
