import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatedEndpoint, EndpointList, WebhookList } from '../src/shared/types';
import { ADMIN_EMAIL, serveAccessKeys } from './helpers/access';
import { adminApi, asAdmin, postJson } from './helpers/admin';
import { ORIGIN } from './helpers/constants';
import {
  STANDARD_SECRET,
  createTestEndpoint,
  deliver,
  detailOf,
  seedWebhooks,
  standardHeaders,
  storedWebhooks,
} from './helpers/hooks';

const OTHER_SITE = 'https://evil.example';

/**
 * Counts the endpoints in the database that carry a name.
 * @param name - The endpoint name.
 * @returns How many there are.
 */
const countEndpoints = async (name: string): Promise<number> =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM endpoints WHERE name = ?').bind(name).first<{ n: number }>())?.n ?? 0;

beforeEach(serveAccessKeys);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin panel', () => {
  it('refuses a visitor who did not come through Cloudflare Access, answering { error }', async () => {
    const refused = await exports.default.fetch(`${ORIGIN}/admin`);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'Sign in through Cloudflare Access to use the admin panel.' });
    const invalid = await exports.default.fetch(`${ORIGIN}/admin/api/me`, { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.token' } });
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: 'Your Cloudflare Access session is not valid for this application.' });
    expect((await exports.default.fetch(`${ORIGIN}/admin/api/endpoints`)).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/admin/api/webhooks`)).status).toBe(401);
  });

  it('refuses the panel files too without an Access sign-in', async () => {
    expect((await exports.default.fetch(`${ORIGIN}/admin/`)).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/admin/assets/anything.js`)).status).toBe(401);
  });

  it('changes nothing for a visitor without an Access sign-in', async () => {
    const name = `anon-${crypto.randomUUID().slice(0, 8)}`;
    const created = await exports.default.fetch(`${ORIGIN}/admin/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ name, format: 'none' }),
    });
    expect(created.status).toBe(401);
    expect(await countEndpoints(name)).toBe(0);

    const endpoint = await createTestEndpoint({ format: 'none' });
    const deleted = await exports.default.fetch(`${ORIGIN}/admin/api/endpoints/${endpoint.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(401);
    expect((await (await adminApi('/endpoints')).json<EndpointList>()).endpoints.map((item) => item.id)).toContain(endpoint.id);
  });

  it('sends /admin to /admin/', async () => {
    const response = await asAdmin('', { redirect: 'manual' });
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe('/admin/');
  });

  it('serves the page with security headers, using only its own script and stylesheet', async () => {
    const response = await asAdmin('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('Content-Security-Policy')).toContain("base-uri 'none'");
    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script type="module"[^>]* src="\/admin\/assets\/[^"]+\.js"/);
    // The page's CSP forbids inline scripts, so the built page must not need any.
    expect(html).not.toMatch(/<script(?![^>]* src=)[^>]*>/);
  });

  it('serves its script with the security headers', async () => {
    const html = await (await asAdmin('/')).text();
    const [, scriptPath] = html.match(/ src="\/admin(\/assets\/[^"]+\.js)"/) ?? [];
    expect(scriptPath).toBeDefined();
    const script = await asAdmin(scriptPath!);
    expect(script.status).toBe(200);
    expect(script.headers.get('Content-Type')).toContain('javascript');
    expect(script.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('sends the site root to the panel', async () => {
    const response = await exports.default.fetch(`${ORIGIN}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin/');
  });
});

describe('admin API', () => {
  it('tells the panel who is signed in and the brand name', async () => {
    const response = await adminApi('/me');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: ADMIN_EMAIL, brand: env.BRAND_NAME });
  });

  it('tells browsers and caches not to keep its answers', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    for (const path of ['/me', '/endpoints', '/webhooks', `/webhooks?endpoint=${endpoint.id}`]) {
      expect((await adminApi(path)).headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('answers errors in the same { error } shape as the receiver', async () => {
    const response = await adminApi('/webhooks/no-such-id');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('answers an unknown API path with a JSON 404, not the panel page', async () => {
    for (const init of [{}, { method: 'POST' }, { method: 'DELETE' }]) {
      const response = await adminApi('/no-such-route', init);
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });

  it('answers a panel file that does not exist with a JSON 404', async () => {
    const response = await asAdmin('/assets/no-such-file.js');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('answers a request that is not a same-site one with { error: "Forbidden" } and 403', async () => {
    const response = await adminApi('/endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: OTHER_SITE, 'Sec-Fetch-Site': 'cross-site' },
      body: 'name=x&format=none',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('answers malformed JSON with { error } and 400', async () => {
    const response = await adminApi('/endpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Malformed JSON in request body' });
  });

  it('answers an unexpected failure with { error } and 500, without its details', async () => {
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('D1 exploded: secret detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await adminApi('/endpoints');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });
});

describe('admin API: endpoints', () => {
  it('creates an endpoint whose URL is this site plus /hooks/ and a long random token', async () => {
    const response = await postJson('/endpoints', { name: 'billing-1', format: 'standard', secret: STANDARD_SECRET });
    expect(response.status).toBe(201);
    const { endpoint } = await response.json<CreatedEndpoint>();
    expect(endpoint).toMatchObject({
      name: 'billing-1',
      format: 'standard',
      createdBy: ADMIN_EMAIL,
      webhookCount: 0,
      lastReceivedAt: null,
    });
    expect(endpoint.url).toMatch(new RegExp(`^${ORIGIN}/hooks/[A-Za-z0-9_-]{43}$`));
    expect(new Date(endpoint.createdAt).toISOString()).toBe(endpoint.createdAt);
  });

  it('gives each endpoint its own token', async () => {
    const first = await createTestEndpoint({ format: 'none' });
    const second = await createTestEndpoint({ format: 'none' });
    expect(first.url).not.toBe(second.url);
  });

  it('never returns the secret, when creating or listing', async () => {
    const secret = 'whsec_c2VjcmV0LXRoYXQtbXVzdC1ub3QtbGVhaw==';
    const response = await postJson('/endpoints', { name: 'no-leak', format: 'standard', secret });
    expect(await response.text()).not.toContain(secret);
    expect(await (await adminApi('/endpoints')).text()).not.toContain(secret);
    expect(await (await adminApi('/endpoints')).text()).not.toContain('c2VjcmV0LXRoYXQtbXVzdC1ub3QtbGVhaw');
  });

  it('ignores a secret sent with format none', async () => {
    const { id } = await createTestEndpoint({ format: 'none', secret: 'ignored' });
    const row = await env.DB.prepare('SELECT secret FROM endpoints WHERE id = ?').bind(id).first<{ secret: string | null }>();
    expect(row?.secret).toBeNull();
  });

  it('refuses a name that is already taken with 409', async () => {
    expect((await postJson('/endpoints', { name: 'taken', format: 'none' })).status).toBe(201);
    const again = await postJson('/endpoints', { name: 'taken', format: 'stripe', secret: 'whsec_x' });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'An endpoint with this name already exists.' });
    expect(await countEndpoints('taken')).toBe(1);
  });

  it.each([
    ['an empty name', { name: '', format: 'none' }],
    ['a missing name', { format: 'none' }],
    ['an upper-case name', { name: 'Stripe', format: 'none' }],
    ['a name with a space', { name: 'my hook', format: 'none' }],
    ['a name with an underscore', { name: 'my_hook', format: 'none' }],
    ['a name of 41 characters', { name: 'a'.repeat(41), format: 'none' }],
    ['a name that is not text', { name: 5, format: 'none' }],
    ['an unknown format', { name: 'ok', format: 'paypal' }],
    ['a missing format', { name: 'ok' }],
    ['no secret for stripe', { name: 'ok', format: 'stripe' }],
    ['a blank secret for github', { name: 'ok', format: 'github', secret: '   ' }],
    ['no secret for standard', { name: 'ok', format: 'standard' }],
    ['a standard secret without whsec_', { name: 'ok', format: 'standard', secret: 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' }],
    ['a standard secret that is not base64', { name: 'ok', format: 'standard', secret: 'whsec_!!!not base64!!!' }],
    ['a standard secret with nothing after whsec_', { name: 'ok', format: 'standard', secret: 'whsec_' }],
    ['a secret over 500 characters', { name: 'ok', format: 'github', secret: 'x'.repeat(501) }],
    ['a body of null', null],
  ])('refuses %s with 400 and an error', async (_case, body) => {
    const response = await postJson('/endpoints', body);
    expect(response.status).toBe(400);
    expect(await response.json<{ error: string }>()).toEqual({ error: expect.any(String) });
  });

  it('refuses a body that is not JSON with 400', async () => {
    const response = await adminApi('/endpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    expect(response.status).toBe(400);
  });

  it('lists endpoints newest first, and by ID when they were created at the same time', async () => {
    const insert = env.DB.prepare(
      `INSERT INTO endpoints (id, name, token, format, secret, created_at, created_by) VALUES (?1, ?1, ?1, 'none', NULL, ?2, 'test')`,
    );
    await env.DB.batch([
      insert.bind('order-b', '2099-01-01T00:00:00.000Z'),
      insert.bind('order-new', '2099-01-02T00:00:00.000Z'),
      insert.bind('order-a', '2099-01-01T00:00:00.000Z'),
      insert.bind('order-oldest', '2098-12-31T00:00:00.000Z'),
    ]);
    const { endpoints } = await (await adminApi('/endpoints')).json<EndpointList>();
    expect(endpoints.map((endpoint) => endpoint.id).filter((id) => id.startsWith('order-'))).toEqual([
      'order-new',
      'order-a',
      'order-b',
      'order-oldest',
    ]);
  });

  it('lists a newly created endpoint before the ones created earlier', async () => {
    const earlier = await createTestEndpoint({ format: 'none' });
    await env.DB.prepare('UPDATE endpoints SET created_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', earlier.id).run();
    const created = await createTestEndpoint({ format: 'none' });
    const { endpoints } = await (await adminApi('/endpoints')).json<EndpointList>();
    const ids = endpoints.map((endpoint) => endpoint.id);
    expect(ids.indexOf(created.id)).toBeLessThan(ids.indexOf(earlier.id));
  });

  it('lists each endpoint with its webhook count and latest delivery', async () => {
    const older = await createTestEndpoint({ format: 'none' });
    const newer = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(older.id, [
      { receivedAt: '2026-01-01T00:00:00.000Z', lastReceivedAt: '2026-01-03T00:00:00.000Z' },
      { receivedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    const { endpoints } = await (await adminApi('/endpoints')).json<EndpointList>();
    expect(endpoints.find((endpoint) => endpoint.id === older.id)).toMatchObject({
      webhookCount: 2,
      lastReceivedAt: '2026-01-03T00:00:00.000Z',
    });
    expect(endpoints.find((endpoint) => endpoint.id === newer.id)).toMatchObject({ webhookCount: 0, lastReceivedAt: null });
  });

  it('deletes an endpoint with its webhooks, and its address stops working', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const other = await createTestEndpoint({ format: 'none' });
    await deliver(endpoint, '{}');
    await deliver(other, '{}');
    expect((await adminApi(`/endpoints/${endpoint.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
    expect(await storedWebhooks(other.id)).toHaveLength(1);
    expect((await deliver(endpoint, '{}')).status).toBe(404);
  });

  it('answers 204 when the endpoint is already gone', async () => {
    expect((await adminApi('/endpoints/no-such-id', { method: 'DELETE' })).status).toBe(204);
  });
});

describe('admin API: webhooks', () => {
  it('lists the webhooks of an endpoint newest first, with a summary and no headers or body', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(endpoint.id, [
      { id: 'old', receivedAt: '2026-02-01T00:00:00.000Z', eventId: 'evt_old' },
      { id: 'new', receivedAt: '2026-02-03T00:00:00.000Z', eventId: 'evt_new' },
      { id: 'mid', receivedAt: '2026-02-02T00:00:00.000Z' },
    ]);
    const { webhooks, nextBefore } = await (await adminApi(`/webhooks?endpoint=${endpoint.id}`)).json<WebhookList>();
    expect(webhooks.map((webhook) => webhook.id)).toEqual(['new', 'mid', 'old']);
    expect(nextBefore).toBeNull();
    expect(webhooks[0]).toEqual({
      id: 'new',
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      eventId: 'evt_new',
      receivedAt: '2026-02-03T00:00:00.000Z',
      lastReceivedAt: '2026-02-03T00:00:00.000Z',
      deliveries: 1,
      contentType: null,
      size: 2,
      verified: false,
    });
  });

  it('filters by endpoint', async () => {
    const first = await createTestEndpoint({ format: 'none' });
    const second = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(first.id, [{ receivedAt: '2026-02-01T00:00:00.000Z' }]);
    await seedWebhooks(second.id, [{ receivedAt: '2026-02-01T00:00:00.000Z' }, { receivedAt: '2026-02-02T00:00:00.000Z' }]);
    const list = (id: string) => adminApi(`/webhooks?endpoint=${id}`).then((response) => response.json<WebhookList>());
    expect((await list(first.id)).webhooks).toHaveLength(1);
    expect((await list(second.id)).webhooks).toHaveLength(2);
    expect((await list('no-such-id')).webhooks).toHaveLength(0);
  });

  it('pages through 60 webhooks, 50 at a time, without skipping or repeating any, even with equal times', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const pad = (n: number) => String(n).padStart(2, '0');
    // Pairs of webhooks share a time, so the order inside a pair must come from the ID.
    await seedWebhooks(
      endpoint.id,
      Array.from({ length: 60 }, (_, i) => ({ id: `id-${pad(i)}`, receivedAt: `2026-03-01T00:${pad(Math.floor(i / 2))}:00.000Z` })),
    );
    const first = await (await adminApi(`/webhooks?endpoint=${endpoint.id}`)).json<WebhookList>();
    expect(first.webhooks).toHaveLength(50);
    expect(first.nextBefore).not.toBeNull();
    const second = await (
      await adminApi(`/webhooks?endpoint=${endpoint.id}&before=${encodeURIComponent(first.nextBefore!)}`)
    ).json<WebhookList>();
    expect(second.webhooks).toHaveLength(10);
    expect(second.nextBefore).toBeNull();

    const expected = Array.from({ length: 60 }, (_, i) => ({ id: `id-${pad(i)}`, time: Math.floor(i / 2) }))
      .sort((a, b) => b.time - a.time || b.id.localeCompare(a.id))
      .map((row) => row.id);
    expect([...first.webhooks, ...second.webhooks].map((webhook) => webhook.id)).toEqual(expected);
  });

  it('refuses a before value that is not a cursor', async () => {
    expect((await adminApi('/webhooks?before=garbage')).status).toBe(400);
  });

  it('searches event IDs and bodies, ignoring case', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(endpoint.id, [
      { id: 'a', receivedAt: '2026-04-01T00:00:00.000Z', eventId: 'evt_Alpha', body: '{"kind":"one"}' },
      { id: 'b', receivedAt: '2026-04-02T00:00:00.000Z', eventId: 'evt_beta', body: '{"customer":"Zenith Corp"}' },
      { id: 'c', receivedAt: '2026-04-03T00:00:00.000Z', body: '{"discount":"50%"}' },
    ]);
    const search = async (q: string) =>
      (await (await adminApi(`/webhooks?endpoint=${endpoint.id}&q=${encodeURIComponent(q)}`)).json<WebhookList>()).webhooks.map(
        (webhook) => webhook.id,
      );
    expect(await search('evt_alpha')).toEqual(['a']);
    expect(await search('zenith')).toEqual(['b']);
    expect(await search('evt_')).toEqual(['b', 'a']);
    expect(await search('nothing-matches')).toEqual([]);
    // % and _ in the search text are plain characters, not wildcards.
    expect(await search('50%')).toEqual(['c']);
    expect(await search('%')).toEqual(['c']);
    expect(await search('evt_a')).toEqual(['a']);
    expect(await search('evt__lpha')).toEqual([]);
  });

  it('searches with text of 100 characters, which D1 would refuse as a LIKE pattern, and cuts longer text to 100', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const hundred = 'abcdefghij'.repeat(10);
    await seedWebhooks(endpoint.id, [
      { id: 'long', receivedAt: '2026-04-01T00:00:00.000Z', body: `{"note":"${hundred}"}` },
      { id: 'short', receivedAt: '2026-04-02T00:00:00.000Z', body: '{"note":"abc"}' },
    ]);
    const search = async (q: string) =>
      (await (await adminApi(`/webhooks?endpoint=${endpoint.id}&q=${encodeURIComponent(q)}`)).json<WebhookList>()).webhooks.map(
        (webhook) => webhook.id,
      );
    expect(await search(hundred)).toEqual(['long']);
    // Text past the 100th character is dropped, so this still finds the body that holds the first 100.
    expect(await search(`${hundred}zzzzzzzzzz`)).toEqual(['long']);
  });

  it('searches together with a before cursor, paging through only the matches', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const time = (day: number) => `2026-05-0${day}T00:00:00.000Z`;
    await seedWebhooks(endpoint.id, [
      { id: 'm1', receivedAt: time(1), body: '{"kind":"needle"}' },
      { id: 'x2', receivedAt: time(2), body: '{"kind":"hay"}' },
      { id: 'm3', receivedAt: time(3), body: '{"kind":"needle"}' },
      { id: 'm4', receivedAt: time(4), body: '{"kind":"needle"}' },
    ]);
    const page = async (before?: string) => {
      const cursor = before ? `&before=${encodeURIComponent(before)}` : '';
      const answer = await adminApi(`/webhooks?endpoint=${endpoint.id}&q=needle${cursor}`);
      return (await answer.json<WebhookList>()).webhooks.map((webhook) => webhook.id);
    };
    expect(await page()).toEqual(['m4', 'm3', 'm1']);
    expect(await page(`${time(4)}_m4`)).toEqual(['m3', 'm1']);
    expect(await page(`${time(3)}_m3`)).toEqual(['m1']);
  });

  it('returns one webhook with parsed headers and the body as received', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const body = '{"a": 1,\n "b": "héllo"}';
    await deliver(endpoint, body, {
      ...(await standardHeaders(STANDARD_SECRET, 'msg_detail', body)),
      'Content-Type': 'application/json',
      Authorization: 'Bearer nope',
    });
    const [stored] = await storedWebhooks(endpoint.id);
    const webhook = await detailOf(stored!.id);
    expect(webhook).toMatchObject({
      eventId: 'msg_detail',
      endpointName: endpoint.name,
      contentType: 'application/json',
      verified: true,
      deliveries: 1,
      body,
      size: new TextEncoder().encode(body).byteLength,
    });
    expect(webhook.headers).toMatchObject({ 'webhook-id': 'msg_detail', 'content-type': 'application/json', authorization: '[redacted]' });
  });

  it('shows the delivery count of a retried event', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await deliver(endpoint, '{}', { 'webhook-id': 'msg_retry' });
    await deliver(endpoint, '{}', { 'webhook-id': 'msg_retry' });
    const { webhooks } = await (await adminApi(`/webhooks?endpoint=${endpoint.id}`)).json<WebhookList>();
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0]?.deliveries).toBe(2);
    expect(webhooks[0]!.lastReceivedAt >= webhooks[0]!.receivedAt).toBe(true);
  });

  it('answers 404 for an unknown webhook', async () => {
    expect((await adminApi('/webhooks/no-such-id')).status).toBe(404);
  });

  it('deletes a webhook', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await deliver(endpoint, '{}');
    const [stored] = await storedWebhooks(endpoint.id);
    expect((await adminApi(`/webhooks/${stored!.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
    expect((await adminApi(`/webhooks/${stored!.id}`, { method: 'DELETE' })).status).toBe(204);
  });
});

describe('admin API answers only its own panel', () => {
  it('gives other sites no CORS permission to read it', async () => {
    const response = await adminApi('/endpoints', { headers: { Origin: OTHER_SITE, 'Sec-Fetch-Site': 'cross-site' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('does not approve a CORS preflight from another site', async () => {
    const response = await adminApi('/endpoints', {
      method: 'OPTIONS',
      headers: {
        Origin: OTHER_SITE,
        'Access-Control-Request-Method': 'DELETE',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });

  it('refuses a form posted from another site', async () => {
    const name = `csrf-${crypto.randomUUID().slice(0, 8)}`;
    const response = await adminApi('/endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: OTHER_SITE, 'Sec-Fetch-Site': 'cross-site' },
      body: `name=${name}&format=none`,
    });
    expect(response.status).toBe(403);
    expect(await countEndpoints(name)).toBe(0);
  });

  it('refuses a delete sent from another site', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await deliver(endpoint, '{}');
    const [stored] = await storedWebhooks(endpoint.id);
    const crossSite = { Origin: OTHER_SITE, 'Sec-Fetch-Site': 'cross-site' };
    expect((await adminApi(`/endpoints/${endpoint.id}`, { method: 'DELETE', headers: crossSite })).status).toBe(403);
    expect((await adminApi(`/webhooks/${stored!.id}`, { method: 'DELETE', headers: crossSite })).status).toBe(403);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(1);
    expect((await deliver(endpoint, '{}')).status).toBe(200);
  });
});
