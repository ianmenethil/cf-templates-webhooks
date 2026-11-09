import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiveResult } from '../src/shared/types';
import { serveAccessKeys } from './helpers/access';
import { ORIGIN } from './helpers/constants';
import {
  STANDARD_SECRET,
  createTestEndpoint,
  deliver,
  githubSignature,
  nowSeconds,
  standardHeaders,
  storedWebhooks,
  stripeSignature,
} from './helpers/hooks';

const BODY = JSON.stringify({ type: 'invoice.paid', amount: 4200 });

const STRIPE_SECRET = 'whsec_stripe_test_secret';
const GITHUB_SECRET = "It's a Secret to Everybody";

/** Shaped like a real token (43 URL-safe characters) but belonging to no endpoint. */
const UNKNOWN_TOKEN = 'u'.repeat(43);

/** Seconds in a minute, for building timestamps that are just inside or outside the 5 minute tolerance. */
const MINUTE = 60;

beforeEach(serveAccessKeys);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /hooks/:token', () => {
  it('answers 404 for a well-formed token that no endpoint has', async () => {
    const response = await exports.default.fetch(`${ORIGIN}/hooks/${UNKNOWN_TOKEN}`, { method: 'POST', body: BODY });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['carrying a character outside base64url', `${'a'.repeat(42)}+`],
    ['carrying base64 padding', `${'a'.repeat(42)}=`],
    ['a word', 'no-such-token'],
  ])('answers 404 to a token %s without touching the rate limiter or the database', async (_case, token) => {
    const prepare = vi.spyOn(env.DB, 'prepare');
    const statuses = new Set<number>();
    // One more than the limit: a counted token would be refused with 429 by now.
    for (let i = 0; i < 301; i++) {
      statuses.add((await exports.default.fetch(`${ORIGIN}/hooks/${token}`, { method: 'POST', body: BODY })).status);
    }
    expect([...statuses]).toEqual([404]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('answers 404 to anything but POST, so the address does not confirm the token exists', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    expect((await exports.default.fetch(endpoint.url)).status).toBe(404);
  });

  it('accepts a body of exactly 1 MB and refuses one byte more with 413, storing nothing', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    expect((await deliver(endpoint, 'a'.repeat(1024 * 1024))).status).toBe(200);
    const tooBig = await deliver(endpoint, 'a'.repeat(1024 * 1024 + 1));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: 'Payload too large' });
    expect(await storedWebhooks(endpoint.id)).toHaveLength(1);
  });

  it('refuses a streamed body over 1 MB, which carries no Content-Length, with 413', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const chunk = new Uint8Array(600 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await exports.default.fetch(endpoint.url, { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(response.status).toBe(413);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it('answers 429 once one endpoint passes 300 deliveries a minute, whatever IP address they come from, without blocking other endpoints', async () => {
    const flooded = `${ORIGIN}/hooks/${'f'.repeat(43)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) {
      // Every request comes from another address: the count is per endpoint, so that changes nothing.
      const headers = { 'CF-Connecting-IP': `198.51.100.${i % 200}` };
      statuses.push((await exports.default.fetch(flooded, { method: 'POST', body: BODY, headers })).status);
    }
    expect(statuses.slice(0, 300).every((status) => status === 404)).toBe(true);
    expect(statuses[300]).toBe(429);

    const other = await createTestEndpoint({ format: 'none' });
    expect((await deliver(other, BODY)).status).toBe(200);
  });
});

describe('format none', () => {
  it('accepts any delivery and stores it as not verified', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const response = await deliver(endpoint, BODY, { 'Content-Type': 'application/json' });
    expect(response.status).toBe(200);
    expect(await response.json<ReceiveResult>()).toEqual({ received: true, duplicate: false });
    const [stored] = await storedWebhooks(endpoint.id);
    expect(stored).toMatchObject({ verified: 0, body: BODY, deliveries: 1 });
  });
});

describe('format standard (Standard Webhooks)', () => {
  it('accepts the delivery from the Standard Webhooks reference library test vector', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1614265330_000);
    const response = await deliver(endpoint, '{"test": 2432232314}', {
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
    expect(response.status).toBe(200);
    expect((await storedWebhooks(endpoint.id))[0]).toMatchObject({ verified: 1, event_id: 'msg_p5jXN8AQM9LWM0D4loKWxJek' });
  });

  it('accepts a valid delivery and stores it as verified', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const response = await deliver(endpoint, BODY, await standardHeaders(STANDARD_SECRET, 'msg_1', BODY));
    expect(response.status).toBe(200);
    expect((await storedWebhooks(endpoint.id))[0]).toMatchObject({ verified: 1, event_id: 'msg_1' });
  });

  it('accepts the delivery when any one of several signatures is valid, and ignores other versions', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const headers = await standardHeaders(STANDARD_SECRET, 'msg_rotate', BODY);
    headers['webhook-signature'] = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1a,ignored ${headers['webhook-signature']}`;
    expect((await deliver(endpoint, BODY, headers)).status).toBe(200);
  });

  it('refuses a delivery signed with another secret, storing nothing', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const wrong = await standardHeaders('whsec_dGhpcyBpcyBhIGRpZmZlcmVudCBzZWNyZXQ=', 'msg_2', BODY);
    const response = await deliver(endpoint, BODY, wrong);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it('refuses a delivery whose body changed after signing', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const headers = await standardHeaders(STANDARD_SECRET, 'msg_3', BODY);
    expect((await deliver(endpoint, `${BODY} `, headers)).status).toBe(401);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it('refuses a signature that only uses an unsupported version', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const headers = await standardHeaders(STANDARD_SECRET, 'msg_4', BODY);
    headers['webhook-signature'] = headers['webhook-signature']!.replace('v1,', 'v2,');
    expect((await deliver(endpoint, BODY, headers)).status).toBe(401);
  });

  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])('refuses a delivery without %s', async (missing) => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const headers = await standardHeaders(STANDARD_SECRET, 'msg_5', BODY);
    delete headers[missing];
    const response = await deliver(endpoint, BODY, headers);
    expect(response.status).toBe(401);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it.each([
    ['4 minutes old', 200, -4 * MINUTE],
    ['6 minutes old', 401, -6 * MINUTE],
    ['6 minutes in the future', 401, 6 * MINUTE],
  ])('a timestamp %s gets %i', async (_case, status, offset) => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const headers = await standardHeaders(STANDARD_SECRET, 'msg_6', BODY, nowSeconds() + offset);
    expect((await deliver(endpoint, BODY, headers)).status).toBe(status);
  });

  it('refuses a timestamp that is not a whole number of seconds', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const headers = await standardHeaders(STANDARD_SECRET, 'msg_7', BODY);
    headers['webhook-timestamp'] = `${headers['webhook-timestamp']}.5`;
    expect((await deliver(endpoint, BODY, headers)).status).toBe(401);
  });
});

describe('format stripe', () => {
  const stripeBody = JSON.stringify({ id: 'evt_1Pq', object: 'event' });

  it('accepts the signature of a fixed example worked out with Node crypto', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1492774577_000);
    const response = await deliver(endpoint, stripeBody, {
      'Stripe-Signature':
        't=1492774577,v1=746324dce9c2cdfd8e5143233e776333d26d7bf45150135b2c1ceb55ad63efe0,v0=6ffbb59b2300aae63f272406069a9788598b792a944a07aba816edb039989a39',
    });
    expect(response.status).toBe(200);
  });

  it('accepts a valid delivery and takes the event ID from the body', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const response = await deliver(endpoint, stripeBody, { 'Stripe-Signature': await stripeSignature(STRIPE_SECRET, stripeBody) });
    expect(response.status).toBe(200);
    expect((await storedWebhooks(endpoint.id))[0]).toMatchObject({ verified: 1, event_id: 'evt_1Pq' });
  });

  it('accepts the delivery when any one of several v1 signatures is valid', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const valid = await stripeSignature(STRIPE_SECRET, stripeBody);
    const header = valid.replace(',v1=', `,v1=${'0'.repeat(64)},v1=`);
    expect((await deliver(endpoint, stripeBody, { 'Stripe-Signature': header })).status).toBe(200);
  });

  it('refuses a delivery signed with another secret, storing nothing', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const response = await deliver(endpoint, stripeBody, { 'Stripe-Signature': await stripeSignature('whsec_other', stripeBody) });
    expect(response.status).toBe(401);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it('refuses a header with only the test scheme v0', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const header = (await stripeSignature(STRIPE_SECRET, stripeBody)).replace(',v1=', ',v0=');
    expect((await deliver(endpoint, stripeBody, { 'Stripe-Signature': header })).status).toBe(401);
  });

  it('ignores a header part that is not name=value instead of reading it as a timestamp', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const valid = await stripeSignature(STRIPE_SECRET, stripeBody);
    // Without an `=`, the bare part `t1` must not be read as a timestamp: it comes before the real one.
    expect((await deliver(endpoint, stripeBody, { 'Stripe-Signature': `t1,${valid},nonsense,` })).status).toBe(200);
    expect((await deliver(endpoint, stripeBody, { 'Stripe-Signature': 'nonsense' })).status).toBe(401);
  });

  it('refuses a delivery without the header', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const response = await deliver(endpoint, stripeBody);
    expect(response.status).toBe(401);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it.each([
    ['4 minutes old', 200, -4 * MINUTE],
    ['6 minutes old', 401, -6 * MINUTE],
    ['6 minutes in the future', 401, 6 * MINUTE],
  ])('a timestamp %s gets %i', async (_case, status, offset) => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const signature = await stripeSignature(STRIPE_SECRET, stripeBody, nowSeconds() + offset);
    expect((await deliver(endpoint, stripeBody, { 'Stripe-Signature': signature })).status).toBe(status);
  });

  it('stores a validly signed body that has no event ID with a null event ID', async () => {
    const endpoint = await createTestEndpoint({ format: 'stripe', secret: STRIPE_SECRET });
    const body = 'not json';
    expect((await deliver(endpoint, body, { 'Stripe-Signature': await stripeSignature(STRIPE_SECRET, body) })).status).toBe(200);
    expect((await storedWebhooks(endpoint.id))[0]?.event_id).toBeNull();
  });
});

describe('format github', () => {
  it('accepts the signature from the example in GitHub documentation', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    const response = await deliver(endpoint, 'Hello, World!', {
      'X-Hub-Signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    });
    expect(response.status).toBe(200);
  });

  it('accepts a valid delivery and takes the event ID from X-GitHub-Delivery', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    const response = await deliver(endpoint, BODY, {
      'X-Hub-Signature-256': await githubSignature(GITHUB_SECRET, BODY),
      'X-GitHub-Delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958',
    });
    expect(response.status).toBe(200);
    expect((await storedWebhooks(endpoint.id))[0]).toMatchObject({ verified: 1, event_id: '72d3162e-cc78-11e3-81ab-4c9367dc0958' });
  });

  it('refuses a delivery signed with another secret, storing nothing', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    const response = await deliver(endpoint, BODY, { 'X-Hub-Signature-256': await githubSignature('another secret', BODY) });
    expect(response.status).toBe(401);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });

  it('refuses a delivery without the header', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    expect((await deliver(endpoint, BODY)).status).toBe(401);
  });

  it('refuses the old SHA-1 header on its own', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    const signature = (await githubSignature(GITHUB_SECRET, BODY)).replace('sha256=', 'sha1=');
    expect((await deliver(endpoint, BODY, { 'X-Hub-Signature': signature })).status).toBe(401);
  });
});

describe('signed bytes', () => {
  it('accepts a signed body that starts with a byte order mark and stores the mark', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const body = `\uFEFF${BODY}`;
    const bytes = new TextEncoder().encode(body);
    expect(bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    const response = await deliver(endpoint, bytes, await standardHeaders(STANDARD_SECRET, 'msg_bom', bytes));
    expect(response.status).toBe(200);
    const [stored] = await storedWebhooks(endpoint.id);
    expect(stored?.body).toBe(body);
    expect(stored?.size).toBe(bytes.byteLength);
  });

  it('accepts a signed body that is not valid UTF-8 and records its size in bytes', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    // {"a":"<0xFF 0xFE>"}: the two bytes in the middle are not UTF-8.
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    const response = await deliver(endpoint, bytes, { 'X-Hub-Signature-256': await githubSignature(GITHUB_SECRET, bytes) });
    expect(response.status).toBe(200);
    const [stored] = await storedWebhooks(endpoint.id);
    expect(stored?.size).toBe(10);
    expect(stored?.size).toBe(bytes.byteLength);
    expect(stored?.body).toBe(new TextDecoder().decode(bytes));
  });

  it('refuses the same invalid bytes when the signature was made over their text form', async () => {
    const endpoint = await createTestEndpoint({ format: 'github', secret: GITHUB_SECRET });
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    const wrong = await githubSignature(GITHUB_SECRET, new TextDecoder().decode(bytes));
    expect((await deliver(endpoint, bytes, { 'X-Hub-Signature-256': wrong })).status).toBe(401);
    expect(await storedWebhooks(endpoint.id)).toHaveLength(0);
  });
});

describe('storing deliveries', () => {
  it('stores a repeated event once and counts the delivery', async () => {
    const endpoint = await createTestEndpoint({ format: 'standard', secret: STANDARD_SECRET });
    const first = await deliver(endpoint, BODY, await standardHeaders(STANDARD_SECRET, 'msg_once', BODY));
    // A retry carries the same webhook-id but is signed again, with a newer timestamp.
    const retry = await deliver(endpoint, BODY, await standardHeaders(STANDARD_SECRET, 'msg_once', BODY, nowSeconds() + 1));
    expect(await first.json<ReceiveResult>()).toEqual({ received: true, duplicate: false });
    expect(await retry.json<ReceiveResult>()).toEqual({ received: true, duplicate: true });
    const rows = await storedWebhooks(endpoint.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveries).toBe(2);
  });

  it('stores one row with every delivery counted when the same event arrives at the same moment', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => deliver(endpoint, BODY, { 'webhook-id': 'msg_parallel' })),
    );
    const results = await Promise.all(responses.map((response) => response.json<ReceiveResult>()));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    const rows = await storedWebhooks(endpoint.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveries).toBe(5);
  });

  it('keeps the same event ID on two endpoints as two webhooks', async () => {
    const first = await createTestEndpoint({ format: 'none' });
    const second = await createTestEndpoint({ format: 'none' });
    await deliver(first, BODY, { 'webhook-id': 'msg_shared' });
    await deliver(second, BODY, { 'webhook-id': 'msg_shared' });
    expect(await storedWebhooks(first.id)).toHaveLength(1);
    expect(await storedWebhooks(second.id)).toHaveLength(1);
  });

  it('stores every delivery that has no event ID', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const first = await (await deliver(endpoint, BODY)).json<ReceiveResult>();
    const second = await (await deliver(endpoint, BODY)).json<ReceiveResult>();
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    const rows = await storedWebhooks(endpoint.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.event_id === null)).toBe(true);
  });

  it('takes the event ID of format none from webhook-id when the sender sends one', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await deliver(endpoint, BODY, { 'webhook-id': 'msg_none' });
    expect((await storedWebhooks(endpoint.id))[0]?.event_id).toBe('msg_none');
  });

  it('stores headers with lower-case names and redacts the ones that carry credentials', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await deliver(endpoint, BODY, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer super-secret',
      'Proxy-Authorization': 'Basic proxy-secret',
      Cookie: 'session=abc',
      'X-Api-Key': 'key-123',
      'X-Gitlab-Token': 'gitlab-456',
      'X-Client-Secret': 'secret-789',
      'X-Password': 'hunter2',
      'X-Custom-Header': 'kept',
    });
    const [stored] = await storedWebhooks(endpoint.id);
    const headers = JSON.parse(stored!.headers) as Record<string, string>;
    expect(headers).toMatchObject({
      authorization: '[redacted]',
      'proxy-authorization': '[redacted]',
      cookie: '[redacted]',
      'x-api-key': '[redacted]',
      'x-gitlab-token': '[redacted]',
      'x-client-secret': '[redacted]',
      'x-password': '[redacted]',
      'content-type': 'application/json',
      'x-custom-header': 'kept',
    });
    for (const secret of ['super-secret', 'proxy-secret', 'session=abc', 'key-123', 'gitlab-456', 'secret-789', 'hunter2']) {
      expect(stored!.headers).not.toContain(secret);
    }
  });

  it('stores the body exactly as received and its size in bytes', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    const body = '{ "name":  "héllo €" }\n';
    await deliver(endpoint, body);
    const [stored] = await storedWebhooks(endpoint.id);
    expect(stored?.body).toBe(body);
    expect(stored?.size).toBe(new TextEncoder().encode(body).byteLength);
  });
});
