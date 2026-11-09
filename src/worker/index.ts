import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env';
import { purgeOldWebhooks } from './lib/webhooks';
import { admin } from './routes/admin';
import { hooks } from './routes/hooks';

const app = new Hono<AppEnv>();

// The bare address opens the admin panel, so the URL a dev server or a new domain shows leads somewhere.
app.get('/', (c) => c.redirect('/admin/'));
app.route('/hooks', hooks);
app.route('/admin', admin);

// Every error answer is `{ error }`, so senders and the admin panel read one shape: the routes answer it
// themselves, and the errors Hono throws (a refused cross-site request, malformed JSON) are turned into it here.
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError(async (error, c) => {
  if (error instanceof HTTPException) {
    // `csrf()` throws with a ready-made response and no message; its body is the status text.
    return c.json({ error: error.message || (await error.res?.text()) || 'Error' }, error.status);
  }
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,
  /** Runs on the daily Cron Trigger in `wrangler.jsonc`: deletes webhooks older than `RETENTION_DAYS`. */
  async scheduled(_controller, env) {
    // Awaited, not handed to `ctx.waitUntil`, so a failed purge fails the cron run instead of vanishing.
    const deleted = await purgeOldWebhooks(env.DB, env.RETENTION_DAYS);
    console.log(`Deleted ${deleted} expired webhooks.`);
  },
} satisfies ExportedHandler<CloudflareBindings>;
