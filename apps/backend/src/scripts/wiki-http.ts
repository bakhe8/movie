/**
 * Cached HTTP for the Wikimedia APIs, shared by the fixture scripts that run
 * after `fetch-catalog.ts` (`fetch-cultural.ts`, `fetch-evidence-ar.ts`).
 * Same cache layout as the catalog fetch — sha1 of the URL → `{ status, body }`
 * under CATALOG_CACHE_DIR — so a URL either script asked for before is served
 * from disk and a re-run is offline. `fetch-catalog.ts` keeps its own copy
 * because it runs its main() at import time and cannot be imported from.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CACHE_DIR = process.env.CATALOG_CACHE_DIR ?? path.join(os.tmpdir(), 'movie-catalog-cache');
// Wikimedia asks for an identifying agent; no personal data in it.
const USER_AGENT = 'movie-taste-demo-catalog/0.1 (local development fixture builder; docs/DEMO_DATA_PLAN_2026-09-03.md)';
const REQUEST_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function cachedGet(url: string): Promise<{ status: number; body: string }> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8')) as { status: number; body: string };
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await sleep(REQUEST_DELAY_MS);
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        // Honour Retry-After when Wikimedia sends one; otherwise back off hard (5 s, 15 s, 45 s).
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 3 ** attempt);
        continue;
      }
      const result = { status: response.status, body };
      // 200 and 404 are both stable answers worth caching; anything else is not.
      if (response.status === 200 || response.status === 404) {
        await writeFile(cachePath, JSON.stringify(result), 'utf8');
      }
      return result;
    } catch (error) {
      lastError = error;
      await sleep(1000 * 3 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`);
}

export async function getJson<T>(url: string): Promise<T | null> {
  const { status, body } = await cachedGet(url);
  if (status === 404) {
    return null;
  }
  if (status !== 200) {
    throw new Error(`HTTP ${status} for ${url}`);
  }
  return JSON.parse(body) as T;
}
