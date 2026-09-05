import { createHash } from 'crypto';

// Which of BP §8.1's triad functions a round serves (ADR-99). 'learn' is new
// evidence. 'verify' re-asks a set this profile has already ranked, drawn
// only when no unseen set is left: it measures consistency, and it never
// counts toward the training threshold, the rounds shown to the user, or
// the trainer's evidence (remediation brief P0-04).
export type TriadPurpose = 'learn' | 'verify';

// One key per *set* of three titles, the same for every permutation, so a
// re-drawn display order of the same films is recognised as the same
// question. md5 of the sorted ids joined by ',' -- the exact expression the
// AddTriadSetHashAndPurpose migration runs in SQL to backfill older rows
// (uuids are lower-case, so text order and JS string order agree).
export function triadSetHash(titleIds: readonly string[]): string {
  return createHash('md5').update([...titleIds].sort().join(',')).digest('hex');
}
