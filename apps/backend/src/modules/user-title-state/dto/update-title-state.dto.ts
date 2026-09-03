import { IsDateString, IsIn, IsNumber, IsOptional, Max, MaxLength, Min } from 'class-validator';
import { TitleState } from '../../../entities/user-title-state.entity';

export class UpdateTitleStateDto {
  @IsIn(['watched', 'not_watched', 'watchlist', 'interested'])
  state: TitleState;

  @IsOptional()
  @IsDateString()
  watchedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  rating?: number;

  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}