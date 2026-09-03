import { IsDateString, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';
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
