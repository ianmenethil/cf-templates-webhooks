import type {
  AdminProfile,
  CreateEndpointRequest,
  CreatedEndpoint,
  Endpoint,
  EndpointList,
  WebhookDetail,
  WebhookList,
  WebhookResponse,
} from "../../shared/types";

/**
 * Calls the admin API and reads its JSON answer.
 * @param path - Path below `/admin/api`.
 * @param init - Request options.
 * @returns The parsed answer, or `undefined` for an empty `204`.
 * @throws An `Error` whose message is the API's `error` field when it has one, to show the person.
 */
const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/admin/api${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `The request failed (${response.status}).`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
};

/** Gets the signed-in user and the brand name. */
export const getProfile = (): Promise<AdminProfile> => request("/me");

/** Gets every endpoint. */
export const getEndpoints = async (): Promise<Endpoint[]> =>
  (await request<EndpointList>("/endpoints")).endpoints;

/**
 * Creates an endpoint.
 * @param endpoint - Its name, signature format and, unless the format is `none`, the secret.
 */
export const createEndpoint = (
  endpoint: CreateEndpointRequest,
): Promise<CreatedEndpoint> =>
  request("/endpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(endpoint),
  });

/**
 * Deletes an endpoint and every webhook it received.
 * @param id - The endpoint to delete.
 */
export const deleteEndpoint = (id: string): Promise<void> =>
  request(`/endpoints/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Filters and paging for {@link getWebhooks}. */
type WebhookQuery = {
  /** Only webhooks received by this endpoint. */
  endpoint?: string;
  /** Only webhooks whose event ID or body contains this text. */
  q?: string;
  /** The `nextBefore` of the previous page. */
  before?: string;
};

/**
 * Gets one page of webhooks, newest first.
 * @param query - Filters and the page to fetch; left out, it is the first page of everything.
 */
export const getWebhooks = ({
  endpoint,
  q,
  before,
}: WebhookQuery = {}): Promise<WebhookList> => {
  const params = new URLSearchParams();
  if (endpoint) params.set("endpoint", endpoint);
  if (q) params.set("q", q);
  if (before) params.set("before", before);
  const query = params.size > 0 ? `?${params}` : "";
  return request(`/webhooks${query}`);
};

/**
 * Gets one webhook with its headers and body.
 * @param id - The webhook to read.
 */
export const getWebhook = async (id: string): Promise<WebhookDetail> =>
  (await request<WebhookResponse>(`/webhooks/${encodeURIComponent(id)}`))
    .webhook;

/**
 * Deletes a webhook.
 * @param id - The webhook to delete.
 */
export const deleteWebhook = (id: string): Promise<void> =>
  request(`/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
