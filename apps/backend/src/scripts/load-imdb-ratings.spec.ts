import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { fetchDumpAtomic, validateDump } from './load-imdb-ratings';

// P0-4: a fresh download must never clobber a known-good dump with a
// truncated or malformed one, and a network/validation failure must not
// throw when a previous good copy can be served instead. Pure filesystem +
// a stubbed global fetch -- no database, no network.

// Small stand-ins for MIN_DUMP_BYTES/MIN_DUMP_LINES: a synthetic, highly
// repetitive fixture gzips to a fraction of the real dump's size for the
// same row count, so every test here passes these explicitly to
// validateDump/fetchDumpAtomic rather than relying on the production floors
// sized for the real ~7 MB, 1.5 M-row dataset.
const TEST_THRESHOLDS = { minBytes: 200, minLines: 1_000 };

function validDumpBuffer(rows = TEST_THRESHOLDS.minLines + 5): Buffer {
  const lines = ['tconst\taverageRating\tnumVotes'];
  for (let i = 0; i < rows; i += 1) {
    lines.push(`tt${i}\t7.0\t100`);
  }
  return gzipSync(Buffer.from(lines.join('\n')));
}

function tempTarget(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'imdb-atomic-'));
  return path.join(dir, 'title.ratings.tsv.gz');
}

function stubFetchOnce(handler: () => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateDump', () => {
  it('accepts a well-formed, large-enough gzipped dump', async () => {
    const target = tempTarget();
    writeFileSync(target, validDumpBuffer());
    const result = await validateDump(target, TEST_THRESHOLDS);
    expect(result.ok).toBe(true);
    expect(result.lineCount).toBeGreaterThan(TEST_THRESHOLDS.minLines);
  });

  it('rejects a file smaller than the size floor', async () => {
    const target = tempTarget();
    writeFileSync(target, gzipSync(Buffer.from('tconst\taverageRating\tnumVotes\ntt1\t7\t1')));
    const result = await validateDump(target, TEST_THRESHOLDS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/byte/);
  });

  it('rejects a dump with the wrong header line', async () => {
    const target = tempTarget();
    const lines = ['not,the,right,header', ...Array.from({ length: TEST_THRESHOLDS.minLines + 5 }, (_, i) => `tt${i}\t7\t1`)];
    writeFileSync(target, gzipSync(Buffer.from(lines.join('\n'))));
    const result = await validateDump(target, TEST_THRESHOLDS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/header/);
  });

  it('rejects a dump with too few rows even when the size floor alone would pass', async () => {
    const target = tempTarget();
    writeFileSync(target, validDumpBuffer(5));
    // minBytes: 0 isolates this to the row-count floor -- the size floor is
    // covered by its own test above.
    const result = await validateDump(target, { minBytes: 0, minLines: TEST_THRESHOLDS.minLines });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/row/);
  });

  it('rejects a truncated gzip stream', async () => {
    const target = tempTarget();
    const full = validDumpBuffer();
    writeFileSync(target, full.subarray(0, Math.floor(full.length / 2)));
    const result = await validateDump(target, TEST_THRESHOLDS);
    expect(result.ok).toBe(false);
  });
});

describe('fetchDumpAtomic', () => {
  it('writes the dump to target when there is nothing there yet and the download validates', async () => {
    const target = tempTarget();
    const body = validDumpBuffer();
    stubFetchOnce(() => new Response(body, { status: 200 }));

    const result = await fetchDumpAtomic('https://example.test/dump.gz', target, TEST_THRESHOLDS);

    expect(result).toEqual({ replaced: true, stale: false });
    expect(readFileSync(target)).toEqual(body);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('replaces a previous good dump with a new valid one', async () => {
    const target = tempTarget();
    writeFileSync(target, validDumpBuffer(TEST_THRESHOLDS.minLines + 10));
    const fresh = validDumpBuffer(TEST_THRESHOLDS.minLines + 20);
    stubFetchOnce(() => new Response(fresh, { status: 200 }));

    const result = await fetchDumpAtomic('https://example.test/dump.gz', target, TEST_THRESHOLDS);

    expect(result).toEqual({ replaced: true, stale: false });
    expect(readFileSync(target)).toEqual(fresh);
  });

  it('falls back to the previous good dump on a network failure, without throwing', async () => {
    const target = tempTarget();
    const previous = validDumpBuffer();
    writeFileSync(target, previous);
    stubFetchOnce(() => {
      throw new Error('network down');
    });

    const result = await fetchDumpAtomic('https://example.test/dump.gz', target, TEST_THRESHOLDS);

    expect(result.replaced).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/network down/);
    expect(readFileSync(target)).toEqual(previous);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('falls back to the previous good dump when the download fails validation', async () => {
    const target = tempTarget();
    const previous = validDumpBuffer();
    writeFileSync(target, previous);
    // An HTML error page, not a dataset -- small and not valid gzip.
    stubFetchOnce(() => new Response('<html>error</html>', { status: 200 }));

    const result = await fetchDumpAtomic('https://example.test/dump.gz', target, TEST_THRESHOLDS);

    expect(result.replaced).toBe(false);
    expect(result.stale).toBe(true);
    expect(readFileSync(target)).toEqual(previous);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('rethrows when the download fails and there is no previous dump at all', async () => {
    const target = tempTarget();
    stubFetchOnce(() => {
      throw new Error('network down');
    });

    await expect(fetchDumpAtomic('https://example.test/dump.gz', target, TEST_THRESHOLDS)).rejects.toThrow('network down');
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('an HTTP error response is treated as a failed download, not written to target', async () => {
    const target = tempTarget();
    stubFetchOnce(() => new Response('nope', { status: 503, statusText: 'Service Unavailable' }));

    await expect(fetchDumpAtomic('https://example.test/dump.gz', target, TEST_THRESHOLDS)).rejects.toThrow(/Download failed/);
    expect(existsSync(target)).toBe(false);
  });
});
