import type { SignatureFormat } from '../../shared/types';

/**
 * How many seconds a signed timestamp may differ from this Worker's clock, in either direction.
 * Stripe's libraries use 5 minutes; the Standard Webhooks spec leaves the value to the receiver.
 */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Prefix of a Standard Webhooks secret; the rest is the key, base64-encoded. */
const STANDARD_SECRET_PREFIX = 'whsec_';

const encoder = new TextEncoder();

/**
 * Decodes the key inside a Standard Webhooks secret.
 * @param secret - A secret: `whsec_` followed by the base64-encoded key.
 * @returns The key bytes, or `null` when the secret has no `whsec_` prefix or the rest is not base64.
 */
export const standardKey = (secret: string): Uint8Array | null => {
  if (!secret.startsWith(STANDARD_SECRET_PREFIX)) {
    return null;
  }
  try {
    const key = Uint8Array.from(atob(secret.slice(STANDARD_SECRET_PREFIX.length)), (char) => char.charCodeAt(0));
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
};

/**
 * Signs bytes with HMAC-SHA256.
 * @param key - The key bytes.
 * @param prefix - Text the sender signs in front of the body, such as `<timestamp>.`; empty when there is none.
 * @param body - The request body bytes, exactly as received.
 * @returns The 32-byte signature of the encoded prefix followed by the body.
 */
const hmacSha256 = async (key: Uint8Array, prefix: string, body: Uint8Array): Promise<Uint8Array> => {
  const head = encoder.encode(prefix);
  const message = new Uint8Array(head.byteLength + body.byteLength);
  message.set(head);
  message.set(body, head.byteLength);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message));
};

/**
 * Writes bytes as base64.
 * @param bytes - The bytes.
 * @returns The base64 text.
 */
const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/**
 * Writes bytes as lower-case hexadecimal.
 * @param bytes - The bytes.
 * @returns The hex text.
 */
const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Checks whether a text equals the expected one without leaking where they differ. Both are hashed to
 * the same size first, as Cloudflare's Workers best practices advise, so a different length reveals nothing.
 * @param provided - The signature the sender sent.
 * @param expected - The signature this Worker computed.
 * @returns `true` when they are equal.
 */
const safeEqual = async (provided: string, expected: string): Promise<boolean> => {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
};

/**
 * Checks whether any of the signatures a sender sent equals the expected one. Every candidate is
 * compared, so the time taken does not show which one matched.
 * @param candidates - The signatures from the request.
 * @param expected - The signature this Worker computed.
 * @returns `true` when one of them matches.
 */
const anyMatches = async (candidates: string[], expected: string): Promise<boolean> =>
  (await Promise.all(candidates.map((candidate) => safeEqual(candidate, expected)))).includes(true);

/**
 * Checks that a signed timestamp is a whole number of seconds close to now.
 * @param value - The timestamp text from the request.
 * @returns `true` when it is within `TIMESTAMP_TOLERANCE_SECONDS` of now.
 */
const isRecent = (value: string): boolean =>
  /^\d{1,12}$/.test(value) && Math.abs(Date.now() / 1000 - Number(value)) <= TIMESTAMP_TOLERANCE_SECONDS;

/**
 * Checks a Standard Webhooks delivery: `webhook-signature` holds one or more `v1,<base64>` signatures
 * of `webhook-id.webhook-timestamp.body`, made with the key inside the `whsec_` secret.
 * @param secret - The endpoint's `whsec_` secret.
 * @param headers - The request headers.
 * @param body - The body bytes exactly as received.
 * @returns The reason it is refused, or `null` when it is valid.
 */
const verifyStandard = async (secret: string, headers: Headers, body: Uint8Array): Promise<string | null> => {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signature = headers.get('webhook-signature');
  if (!id || !timestamp || !signature) {
    return 'Missing webhook-id, webhook-timestamp or webhook-signature header';
  }
  const key = standardKey(secret);
  if (!key || !isRecent(timestamp)) {
    return key ? 'Timestamp is too old or too new' : 'Invalid signature';
  }
  const expected = toBase64(await hmacSha256(key, `${id}.${timestamp}.`, body));
  const candidates = signature
    .split(' ')
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice('v1,'.length));
  return (await anyMatches(candidates, expected)) ? null : 'Invalid signature';
};

/**
 * Checks a Stripe delivery: `Stripe-Signature` is `t=<seconds>,v1=<hex>,...` and each `v1` is the hex
 * HMAC-SHA256 of `<t>.<body>`, keyed with the secret as written. Other schemes are ignored.
 * @param secret - The endpoint's signing secret.
 * @param headers - The request headers.
 * @param body - The body bytes exactly as received.
 * @returns The reason it is refused, or `null` when it is valid.
 */
const verifyStripe = async (secret: string, headers: Headers, body: Uint8Array): Promise<string | null> => {
  const header = headers.get('stripe-signature');
  if (!header) {
    return 'Missing Stripe-Signature header';
  }
  // A part without `=` is not a `name=value` pair and is ignored.
  const pairs = header.split(',').flatMap((part) => {
    const at = part.indexOf('=');
    return at === -1 ? [] : [[part.slice(0, at).trim(), part.slice(at + 1).trim()] as const];
  });
  const timestamp = pairs.find(([name]) => name === 't')?.[1];
  if (!timestamp || !isRecent(timestamp)) {
    return timestamp ? 'Timestamp is too old or too new' : 'Invalid signature';
  }
  const expected = toHex(await hmacSha256(encoder.encode(secret), `${timestamp}.`, body));
  const candidates = pairs.filter(([name]) => name === 'v1').map(([, value]) => value.toLowerCase());
  return (await anyMatches(candidates, expected)) ? null : 'Invalid signature';
};

/**
 * Checks a GitHub delivery: `X-Hub-Signature-256` is `sha256=` followed by the hex HMAC-SHA256 of the
 * body, keyed with the secret as written. GitHub sends no timestamp, so there is no age check.
 * @param secret - The endpoint's signing secret.
 * @param headers - The request headers.
 * @param body - The body bytes exactly as received.
 * @returns The reason it is refused, or `null` when it is valid.
 */
const verifyGithub = async (secret: string, headers: Headers, body: Uint8Array): Promise<string | null> => {
  const header = headers.get('x-hub-signature-256');
  if (!header) {
    return 'Missing X-Hub-Signature-256 header';
  }
  const expected = `sha256=${toHex(await hmacSha256(encoder.encode(secret), '', body))}`;
  return (await safeEqual(header.toLowerCase(), expected)) ? null : 'Invalid signature';
};

/**
 * Checks that a delivery really comes from the sender, using the format chosen for its endpoint.
 * Format `none` accepts everything: only the secret token in the URL protects such an endpoint.
 * @param format - The endpoint's signature format.
 * @param secret - The endpoint's signing secret; present for every format except `none`.
 * @param headers - The request headers.
 * @param body - The body bytes exactly as received; the signature covers these bytes, so they are never decoded first.
 * @returns The reason the delivery is refused, or `null` when it is valid.
 */
export const verifySignature = async (
  format: SignatureFormat,
  secret: string | null,
  headers: Headers,
  body: Uint8Array,
): Promise<string | null> => {
  if (format === 'none') {
    return null;
  }
  if (!secret) {
    return 'Invalid signature';
  }
  switch (format) {
    case 'standard':
      return verifyStandard(secret, headers, body);
    case 'stripe':
      return verifyStripe(secret, headers, body);
    case 'github':
      return verifyGithub(secret, headers, body);
  }
};
