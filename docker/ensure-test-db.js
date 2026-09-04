#!/usr/bin/env node
// Idempotent: creates `moviedb_test` inside the shared `movie-postgres`
// container if it doesn't already exist yet (board C-17 -- the e2e test
// suite's database now lives in the same instance as dev, not a separate
// disposable `postgres-test` container). No-op if it's already there, which
// covers both a fresh volume (docker/init-test-db.sql already created it on
// first init) and a volume from before C-17 (created once by hand).
//
// Uses `execFileSync` (argv array, no shell) rather than a single command
// string so quoting works the same on Windows and POSIX.
const { execFileSync } = require('node:child_process');

const CONTAINER = 'movie-postgres';
const USER = process.env.POSTGRES_USER || 'movieapp';
const DB = process.env.POSTGRES_DB || 'moviedb';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', USER, '-d', DB, '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

const exists = psql("SELECT 1 FROM pg_database WHERE datname = 'moviedb_test'");
if (exists === '1') {
  console.log('moviedb_test already exists.');
} else {
  psql('CREATE DATABASE moviedb_test');
  console.log('Created moviedb_test.');
}
