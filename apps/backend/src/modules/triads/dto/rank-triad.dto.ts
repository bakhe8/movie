import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class RankTriadDto {
  // Title ids in ranked order, best-liked first (ADR-15) -- not indices
  // into triad.titleIds. TriadsService checks length, uniqueness and that
  // this is exactly the triad's own three title ids: the last check needs
  // the fetched triad row, so it can't live in this DTO.
  // Bounded here as well (AUDIT_2026-09-05 §4): an oversized array is
  // refused before any query, like every other bounded field; the exact
  // "these three ids" check still belongs to the service.
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  ranking: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sessionId?: string;
}
