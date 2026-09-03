import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class RankTriadDto {
  // Title ids in ranked order, best-liked first (ADR-15) -- not indices
  // into triad.titleIds. TriadsService checks length, uniqueness and that
  // this is exactly the triad's own three title ids: the last check needs
  // the fetched triad row, so it can't live in this DTO.
  @IsArray()
  @IsString({ each: true })
  ranking: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sessionId?: string;
}
