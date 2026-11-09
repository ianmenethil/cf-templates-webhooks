import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

/**
 * Rate limits an endpoint's public address. Each endpoint gets one allowance, shared by every sender
 * that posts to it, so one endpoint being flooded cannot block the others. The allowance is keyed by
 * the `:token` in the path rather than by IP address: Cloudflare advises against IP keys because many
 * senders can share one address. The admin panel is not limited here; Cloudflare Access guards it.
 *
 * It runs before the token is looked up in the database, but after the token's shape is checked, so only
 * well-formed tokens get a key. It does not limit guessing: that is left to the tokens being 256 random bits.
 */
export const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const { success } = await c.env.RATE_LIMITER.limit({ key: `hooks:${c.req.param('token')}` });
  if (!success) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  await next();
});
