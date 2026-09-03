import { IsIn } from 'class-validator';

// The other two OutcomeType values are written elsewhere, never through this
// caller-facing endpoint: 'watched' by WatchEventsService (ADR-66, a real
// watch, not a click), 'ranked_later' would need TriadsService to notice a
// previously-recommended title re-entering a triad -- not built yet, still
// open (ADR-67's own "Still open").
export class CreateOutcomeDto {
  @IsIn(['saved', 'clicked', 'dismissed_not_relevant', 'opened_provider'])
  type: 'saved' | 'clicked' | 'dismissed_not_relevant' | 'opened_provider';
}
