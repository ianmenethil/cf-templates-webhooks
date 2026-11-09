import { exports } from 'cloudflare:workers';
import { accessToken } from './access';
import { ORIGIN } from './constants';

/**
 * Calls an admin path the way the panel does in a browser: with the Access token Cloudflare
 * forwards for a signed-in user and the headers a browser adds to a same-site request.
 * @param path - Path below `/admin`.
 * @param init - Request options.
 * @returns The Worker's response.
 */
export const asAdmin = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set('Cf-Access-Jwt-Assertion', await accessToken());
  if (!headers.has('Origin')) {
    headers.set('Origin', ORIGIN);
    headers.set('Sec-Fetch-Site', 'same-origin');
  }
  return exports.default.fetch(`${ORIGIN}/admin${path}`, { ...init, headers });
};

/**
 * Calls the admin API the way the panel does.
 * @param path - Path below `/admin/api`.
 * @param init - Request options.
 * @returns The Worker's response.
 */
export const adminApi = (path: string, init?: RequestInit): Promise<Response> => asAdmin(`/api${path}`, init);

/**
 * Posts JSON to the admin API.
 * @param path - Path below `/admin/api`.
 * @param body - The value to send as JSON.
 * @returns The Worker's response.
 */
export const postJson = (path: string, body: unknown): Promise<Response> =>
  adminApi(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
