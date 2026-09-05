import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// P1-1: the Anthropic and TMDB credentials belong to offline tooling --
// catalogue enrichment (services/workers, run by hand) and the poster fetch
// script. No user request touches either, so neither belongs in the deployed
// backend's environment: a key that is not there cannot leak from there, be
// read by a dependency, or end up in a stack trace.
//
// That is an argument about the *code*, and it stops being true the moment
// some service reads one of these variables. This test is what keeps the
// argument honest, and it is also the reason the operator can safely delete
// the two variables from the backend service.
const SERVICE_ROOT = path.resolve(__dirname);
// Everything under src/ is the service, except the scripts directory, which
// is exactly the offline tooling these keys are for.
const OFFLINE_TOOLING = path.join(SERVICE_ROOT, 'scripts');
const FORBIDDEN = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'TMDB_API_KEY', 'TMDB_READ_ACCESS_TOKEN'];

function serviceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (full === OFFLINE_TOOLING) return [];
    if (statSync(full).isDirectory()) return serviceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('the backend service reads no offline-tooling credential', () => {
  it.each(FORBIDDEN)('never mentions %s outside src/scripts', (variable) => {
    const offenders = serviceFiles(SERVICE_ROOT).filter((file) => readFileSync(file, 'utf8').includes(variable));
    expect(offenders.map((file) => path.relative(SERVICE_ROOT, file))).toEqual([]);
  });
});
