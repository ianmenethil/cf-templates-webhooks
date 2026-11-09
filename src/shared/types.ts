/**
 * Types shared by the Worker and the admin panel: the admin API's requests and answers.
 * Incoming webhooks themselves have no fixed shape; they are stored exactly as received.
 */

/** How an endpoint checks that a webhook really comes from its sender. */
export const SIGNATURE_FORMATS = ['none', 'standard', 'stripe', 'github'] as const;

/**
 * `none`: only the secret URL token; `standard`: Standard Webhooks (`webhook-signature`);
 * `stripe`: `Stripe-Signature`; `github`: `X-Hub-Signature-256`.
 */
export type SignatureFormat = (typeof SIGNATURE_FORMATS)[number];

/** Endpoint names are 1 to 40 lower-case letters, digits and hyphens, so they are safe in a URL or a log line. */
export const ENDPOINT_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;

/** A named address that receives webhooks, as the admin API returns it. */
export type Endpoint = {
  /** Identifier used in admin API paths. */
  id: string;
  /** Name shown in the admin panel, for example `stripe`. */
  name: string;
  /** Signature check applied to every webhook this endpoint receives. */
  format: SignatureFormat;
  /** The full address senders post to: `https://<host>/hooks/<token>`. */
  url: string;
  /** ISO 8601 time the endpoint was created. */
  createdAt: string;
  /** Email of the admin who created it. */
  createdBy: string;
  /** Number of webhooks stored for this endpoint. */
  webhookCount: number;
  /** ISO 8601 time of the latest delivery, or `null` when none has arrived. */
  lastReceivedAt: string | null;
};

/** Body of `POST /admin/api/endpoints`. `secret` is required unless `format` is `none`. */
export type CreateEndpointRequest = {
  name: string;
  format: SignatureFormat;
  secret?: string;
};

/** A stored webhook as the list shows it, without headers and body. */
export type WebhookSummary = {
  /** Identifier used in admin API paths. */
  id: string;
  endpointId: string;
  endpointName: string;
  /** The sender's event or delivery ID, or `null` when the request carried none. */
  eventId: string | null;
  /** ISO 8601 time of the first delivery. */
  receivedAt: string;
  /** ISO 8601 time of the latest delivery of the same event. */
  lastReceivedAt: string;
  /** How many times this event arrived; more than 1 means the sender retried. */
  deliveries: number;
  /** The request's `Content-Type`, or `null`. */
  contentType: string | null;
  /** Body size in bytes. */
  size: number;
  /** `true` when the endpoint checked a signature and it was valid; `false` for format `none`. */
  verified: boolean;
};

/** A stored webhook with everything it was received with. */
export type WebhookDetail = WebhookSummary & {
  /**
   * Request headers, lower-cased names. The values of `authorization`, `proxy-authorization`, `cookie` and of
   * any header whose name contains `token`, `secret`, `api-key` (or `api_key`, `apikey`) or `password` are
   * replaced with `[redacted]`.
   */
  headers: Record<string, string>;
  /** The body exactly as received, as text. */
  body: string;
};

/** Answer of `GET /admin/api/me`. */
export type AdminProfile = { email: string; brand: string };

/** Answer of `GET /admin/api/endpoints`. */
export type EndpointList = { endpoints: Endpoint[] };

/** Answer of `POST /admin/api/endpoints`. */
export type CreatedEndpoint = { endpoint: Endpoint };

/**
 * Answer of `GET /admin/api/webhooks?endpoint=<id>&q=<text>&before=<cursor>`, newest first.
 * `q` matches the event ID or body text. Pass `nextBefore` as `before` for the next page; `null` means no more.
 */
export type WebhookList = { webhooks: WebhookSummary[]; nextBefore: string | null };

/** Answer of `GET /admin/api/webhooks/:id`. */
export type WebhookResponse = { webhook: WebhookDetail };

/** Answer of `POST /hooks/<token>` when the webhook is accepted. */
export type ReceiveResult = { received: true; duplicate: boolean };
