import { readFile } from 'node:fs/promises';
import { build } from 'vite';

/**
 * Builds the admin panel before the tests run, so they request the real page and files through the
 * Worker's `ASSETS` binding (see `assets` in wrangler.jsonc) instead of a stand-in. It also checks
 * that the built Worker does not carry the inline-script allowance used only by `vite dev`; inline
 * styles are allowed on purpose, for shadcn's toast and dialog.
 */
export default async function setup(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV;
  // Vitest sets NODE_ENV to `test`; the build needs the production setting.
  process.env.NODE_ENV = 'production';
  try {
    await build({ mode: 'production', logLevel: 'warn' });
  } finally {
    if (nodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = nodeEnv;
    }
  }
  const worker = await readFile('dist/webhooks/index.js', 'utf8');
  // The script allowance is the only one tied to `import.meta.env.DEV`; in a build it must have collapsed
  // to `["'self'"]`, so a ternary that still offers `'unsafe-inline'` means the dev value reached production.
  if (/\?\s*\[\s*["']'self'["']\s*,\s*["']'unsafe-inline'["']\s*\]/.test(worker)) {
    throw new Error("The built Worker allows inline scripts: the dev-only 'unsafe-inline' reached the build.");
  }
}
