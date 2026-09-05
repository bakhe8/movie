import { IsDateString, IsIn, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import { WatchEventSource } from '../../../entities/watch-event.entity';

// No `rating`/liking field here either, same rule as UpdateTitleStateDto
// (BP §2.4 principle #2, §4.5): "does not imply liking" (API.md's own words
// for this endpoint). The only explicit preference signal this product ever
// collects is a triad ranking.
export class CreateWatchEventDto {
  @IsUUID()
  titleId: string;

  @IsOptional()
  @IsDateString()
  watchedAt?: string;

  // ADR-104: the day the watch belongs to, as the client's own local day.
  // Without it the server derives one from `watchedAt` in UTC, which is the
  // previous or next day for a good part of the world.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'watchedOn must be YYYY-MM-DD' })
  watchedOn?: string;

  // ADR-110: the recommendation this watch followed, as the client knows it.
  // Without it the server links the most recent recommendation for the same
  // (profile, title), which is a guess -- right in the common case, wrong
  // whenever the same title was recommended more than once.
  @IsOptional()
  @IsUUID()
  recommendationId?: string;

  @IsIn(['in_app', 'import', 'manual'])
  source: WatchEventSource;

  @IsOptional()
  @MaxLength(5)
  audioLanguage?: string;

  @IsOptional()
  @MaxLength(5)
  subtitleLanguage?: string;

  @IsOptional()
  @MaxLength(200)
  provider?: string;
}
