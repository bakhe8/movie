import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, MaxLength, Min } from 'class-validator';

export class ListTitlesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @MaxLength(100)
  genre?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1870)
  @Max(2100)
  year?: number;
}