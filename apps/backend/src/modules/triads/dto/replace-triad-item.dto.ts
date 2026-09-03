import { IsIn, IsUUID } from 'class-validator';
import { REPLACEMENT_REASONS, type ReplacementReason } from '../../../entities/triad-replacement.entity';

export class ReplaceTriadItemDto {
  // Must be one of the triad's own three title ids. That check needs the
  // fetched triad row, so it lives in TriadsService.replace(), not here.
  @IsUUID()
  titleId: string;

  // Exactly the two neutral reasons of ADR-17 -- there is deliberately no
  // "didn't like it" here: the only explicit preference signal anywhere is
  // the triad ranking itself (blueprint §2.4 #2).
  @IsIn(REPLACEMENT_REASONS)
  reason: ReplacementReason;
}
