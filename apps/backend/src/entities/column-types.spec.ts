import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Board 16 (was M2): a `@Column()` with no explicit type relies on
// `emitDecoratorMetadata`, which tsc provides and esbuild-based runners
// (`npx tsx`) never do -- so every TS script that opened the DataSource
// under tsx died on the first such column ("Column type for User#email is
// not defined and cannot be guessed"). Every column now names its type, and
// this scan keeps it that way: a new bare `@Column()` fails here, not in
// somebody's script weeks later.
const ENTITIES_DIR = __dirname;
const COLUMN = /^\s*@(?:Primary)?Column\((.*)\)\s*$/;

function untypedColumns(file: string): string[] {
  const lines = readFileSync(join(ENTITIES_DIR, file), 'utf8').split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const match = COLUMN.exec(line);
    if (!match) return [];
    const args = match[1].trim();
    const typed = args.startsWith("'") || args.startsWith('"') || /\btype\s*:/.test(args);
    return typed ? [] : [`${file}:${index + 1} ${line.trim()}`];
  });
}

describe('entity columns', () => {
  it('every @Column and @PrimaryColumn names its type explicitly, so the entities load without decorator metadata', () => {
    const files = readdirSync(ENTITIES_DIR).filter((file) => file.endsWith('.entity.ts'));

    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(untypedColumns)).toEqual([]);
  });
});
