import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { envTemplate } from '../server/cli/init';
import { EnvSchema } from '../server/env';

const REQUIRED_ACTIVE = [
  'APP_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'DATABASE_URL',
  'DATABASE_URL_TEST',
  'NODE_ENV',
  'PORT',
  'SUPER_ADMIN_EMAILS',
];

const example = readFileSync(path.join(import.meta.dir, '..', '.env.example'), 'utf8');
const activeEntries = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2]]);
const allKeys = (text: string) =>
  new Set([...text.matchAll(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

describe('.env.example', () => {
  test('only required keys are active, so copying it never pins code defaults', () => {
    expect(activeEntries.map(([k]) => k).sort()).toEqual(REQUIRED_ACTIVE);
  });

  test('active placeholder values pass EnvSchema (fresh copy boots)', () => {
    expect(EnvSchema.safeParse(Object.fromEntries(activeEntries)).success).toBe(true);
  });

  test('documents every key the `st4s init` template writes', () => {
    const documented = allKeys(example);
    const missing = [...allKeys(envTemplate('x'))].filter((k) => !documented.has(k));
    expect(missing).toEqual([]);
  });
});
