import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RankTriadDto } from './rank-triad.dto';

async function errorsFor(body: unknown) {
  return validate(plainToInstance(RankTriadDto, body));
}

describe('RankTriadDto', () => {
  it('accepts three title ids', async () => {
    expect(await errorsFor({ ranking: ['a', 'b', 'c'] })).toEqual([]);
  });

  // AUDIT_2026-09-05 §4: the service checks the exact shape against the
  // triad row, but an oversized array is rejected at the door, before any
  // query, the way every other bounded field is.
  it('rejects more than three entries before the service is reached', async () => {
    const errors = await errorsFor({ ranking: ['a', 'b', 'c', 'd'] });

    expect(errors.map((error) => error.property)).toEqual(['ranking']);
    expect(Object.keys(errors[0].constraints ?? {})).toContain('arrayMaxSize');
  });

  it('still rejects a non-array and non-string entries', async () => {
    expect((await errorsFor({ ranking: 'a,b,c' })).map((error) => error.property)).toEqual(['ranking']);
    expect((await errorsFor({ ranking: ['a', 2, 'c'] })).map((error) => error.property)).toEqual(['ranking']);
  });
});
