// package.json directly, not server/app-info.ts: app-info imports env.ts, which throws without DATABASE_URL.
import pkg from '../../package.json' with { type: 'json' };

/** `st4s 0.1.0 (bun 1.x)` — works with no .env at all. */
export function versionLine(): string {
  return `${pkg.name} ${pkg.version} (bun ${Bun.version})`;
}
