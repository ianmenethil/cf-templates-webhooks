import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Test-only binding set in vitest.config.ts: the migrations that test/setup.ts applies to `DB`. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
