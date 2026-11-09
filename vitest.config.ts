import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { AUD, TEAM_DOMAIN } from './test/helpers/constants';

// Read in Node here and handed to the tests as a binding, because the tests run in the Workers runtime.
const migrations = await readD1Migrations(join(import.meta.dirname, 'migrations'));

export default defineConfig({
  test: {
    // Builds the admin panel so its files exist for the Worker's ASSETS binding.
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Fixed values the tests rely on, so a local .dev.vars does not change them: the Access settings
      // that match the tokens the tests sign (test/helpers/access.ts), and the migrations for test/setup.ts.
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
          ACCESS_AUD: AUD,
        },
      },
    }),
  ],
});
