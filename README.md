# Webhooks

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ianmenethil/cf-templates-webhooks)

<!-- dash-content-start -->

Your own webhook receiver on Cloudflare Workers, with an admin panel only your team can open.

Create an endpoint for each sender, such as Stripe or GitHub. Each endpoint gets its own address like `https://hooks.ianmenethil.com/hooks/k3J9vX2mQ7aLw0RZtB5nYc8dEfHgU1iOpS4xVzNyMrA`. The Worker checks the sender's signature, stores the webhook, and answers straight away.

- **Admin panel.** Create endpoints, copy their URLs, and read every webhook that arrives: headers, body, size and how many times it was delivered. Search and filter them, and delete them, in light or dark mode. It lives at `/admin` behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/), so only people you allow can sign in.
- **Signature checks.** Each endpoint checks one format: [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [Stripe](https://docs.stripe.com/webhooks) or [GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries). A webhook with a wrong or missing signature is refused and not stored. Standard Webhooks and Stripe signatures must also be less than 5 minutes old (or 5 minutes ahead of the Worker's clock). An endpoint can also skip the check, and then only its secret URL protects it.
- **Retries are counted, not stored twice.** Webhooks go into [D1](https://developers.cloudflare.com/d1/), Cloudflare's SQL database. A webhook is identified by the event ID the sender gives it. When the sender retries it, the panel shows a higher delivery count instead of a second copy.
- **Limits.** A body can be up to 1 MB. Cloudflare's [rate limiter](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) allows each endpoint 300 webhooks a minute, counted per Cloudflare location. One flooded endpoint does not block the others.
- **Cleans up after itself.** A daily [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) deletes webhooks whose latest delivery is older than `RETENTION_DAYS` (30 by default).

Built with [React](https://react.dev), [Vite](https://vite.dev), [shadcn/ui](https://ui.shadcn.com) and [Tailwind CSS](https://tailwindcss.com) for the admin panel, [Hono](https://hono.dev), [D1](https://developers.cloudflare.com/d1/), the Workers [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

<!-- dash-content-end -->

## Get started

The example values below use a sample company, Menethil, with the site `ianmenethil.com`, the Worker domain `hooks.ianmenethil.com` and the admin `admin@ianmenethil.com`. Replace them with your own.

### 1. Deploy

Click **Deploy to Cloudflare** above. Cloudflare copies this template into your GitHub or GitLab account and deploys the Worker.

The template's `wrangler.jsonc` declares a D1 database binding called `DB`, named `webhooks`, with no database ID. Cloudflare's deploy button [provisions the resources](https://developers.cloudflare.com/workers/platform/deploy-buttons/) that the Wrangler configuration declares. The template's deploy script, `pnpm run deploy`, builds the admin panel, applies the SQL files in `migrations/` to the database, then deploys the Worker. The migration creates the `endpoints` and `webhooks` tables.

The template has no secrets: `.dev.vars.example` lists none, so there is nothing to enter. Each sender's signing secret is typed into the admin panel later and stored in D1.

If the first deploy fails at the migration step, apply the migration by hand and deploy again:

```bash
pnpm exec wrangler d1 migrations apply DB --remote
```

### 2. Set your company name and how long to keep webhooks

In your copy of the repository, edit the `vars` in `wrangler.jsonc` and push the change (Cloudflare redeploys automatically). Do not change them in the dashboard: every deploy replaces the dashboard values with the ones in `wrangler.jsonc`.

| Variable | Set it to | Example |
| --- | --- | --- |
| `BRAND_NAME` | Your company name, shown in the admin panel | `Menethil` |
| `RETENTION_DAYS` | Days to keep a webhook after its latest delivery, a whole number above 0 | `30` |

Any other value of `RETENTION_DAYS` means 30, so a typo cannot delete everything.

### 3. Give the Worker its own domain

Add a [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) such as `hooks.ianmenethil.com` under the Worker's **Settings → Domains & Routes**. Senders post to this domain. Open the admin panel on it too: the endpoint URLs the panel shows are built from the address you opened it on, so opening it on a `workers.dev` address shows `workers.dev` URLs.

### 4. Protect the admin panel with Cloudflare Access

1. Open [Cloudflare One](https://one.dash.cloudflare.com/) and go to **Access controls → Applications → Add an application → Self-hosted**.
2. Add the destination `hooks.ianmenethil.com` with the path `admin`. Only `/admin` is protected; `/hooks` must stay public, because Stripe, GitHub and other senders cannot sign in.
3. Add a policy that allows the people who should read webhooks, for example **Emails** `admin@ianmenethil.com` or **Emails ending in** `@ianmenethil.com`.
4. Save, then copy the application's **Application Audience (AUD) Tag**.

Do not use the Worker's one-click **Protect this Worker behind Access** setting. It protects every path, including `/hooks`, so every sender would be turned away.

### 5. Tell the Worker which Access application to trust

Set two more `vars` in `wrangler.jsonc` and push the change, as in step 2:

| Variable | Set it to | Example |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Your Zero Trust team domain | `https://menethil.cloudflareaccess.com` |
| `ACCESS_AUD` | The AUD tag from step 4 | `4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2` |

A trailing slash on the team domain is ignored. Until both are set, `/admin` answers `403` to everyone.

### 6. Create your first endpoint

Open `https://hooks.ianmenethil.com/admin` and sign in with Access. Enter a name such as `test` (1 to 40 lower-case letters, numbers and hyphens), leave the signature format on **None**, and select **Create endpoint**. Copy the URL the panel shows.

### 7. Send a test webhook

Post to the endpoint's URL with `curl`. The `webhook-id` header is the event ID. This endpoint has no signature check, so it uses `webhook-id` the way a Standard Webhooks sender would.

```bash
curl -X POST https://hooks.ianmenethil.com/hooks/k3J9vX2mQ7aLw0RZtB5nYc8dEfHgU1iOpS4xVzNyMrA \
  -H "Content-Type: application/json" \
  -H "webhook-id: msg_test_1" \
  -d '{"hello":"world"}'
```

```json
{ "received": true, "duplicate": false }
```

Open the panel and the webhook is in the list. Run the same command again: the answer is `"duplicate": true`, and the panel shows the same webhook with 2 deliveries.

## Connect a real sender

Create an endpoint for each sender, pick the sender's signature format, and paste the signing secret. The secret is stored and never shown again. It cannot be edited either: to change it, create a new endpoint and give the sender the new URL. Then give the sender the endpoint's URL.

Anyone who has an endpoint's URL can post to it, so a signature format is what proves a request really comes from the sender. Treat the URL as private as well.

### Stripe

1. In the Stripe Dashboard, open the [Webhooks tab in Workbench](https://dashboard.stripe.com/webhooks) and click **Create an event destination**. Choose the events you want, select **Webhook endpoint** as the destination type, and paste the endpoint's URL as the **Endpoint URL**.
2. On the destination's settings page, click **Reveal secret** and copy the signing secret that starts with `whsec_`. You can open it again later from the destination in the Webhooks tab.
3. In the panel, create an endpoint with format **Stripe** and paste that secret.

Stripe makes a different secret for each endpoint, and a different one for test and live API keys. Create one panel endpoint for each. Stripe's `stripe listen` command prints its own signing secret for local testing.

### GitHub

1. In the repository, open **Settings → Webhooks → Add webhook** (for an organization, the organization's **Settings → Webhooks**).
2. Paste the endpoint's URL as the **Payload URL**, choose the content type `application/json`, and type a long random string in the **Secret** field. You make this secret up; GitHub does not generate it. For example: `openssl rand -hex 32`.
3. In the panel, create an endpoint with format **GitHub** and paste the same string.

GitHub sends a `ping` event when you save the webhook, so it is the first webhook in the panel.

### Standard Webhooks

[Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) is an open specification that some senders follow. The sender signs each webhook and sends `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. The specification does not say how a receiver gets the signing secret, so look in the sender's own webhook settings or documentation. The secret starts with `whsec_` followed by base64 text. Create an endpoint with format **Standard Webhooks** and paste it.

## Duplicates and retries

Senders send a webhook again when they get no answer, and may send the same event twice. The Worker recognises a repeat by the event ID, per endpoint:

| Format | Event ID |
| --- | --- |
| Standard Webhooks | The `webhook-id` header |
| Stripe | The `id` of the event in the JSON body, such as `evt_1Mq...` |
| GitHub | The `X-GitHub-Delivery` header |
| None | The `webhook-id` header, if the sender sends one |

- The first delivery is stored with its headers and body. A repeat only adds 1 to its delivery count and updates its latest delivery time; the repeat's own body is not kept. Two repeats that arrive at the same moment still make one webhook.
- The same event ID on two different endpoints is two webhooks.
- A request with no event ID, such as an unsigned post with no `webhook-id`, is stored every time. IDs longer than 255 characters are cut to 255.
- A repeat must pass the signature check too, like any delivery.
- Stripe warns that in some cases it sends two separate events for the same thing, with different IDs. These are two webhooks here.
- GitHub does not retry failed deliveries by itself. When you redeliver one by hand, the panel counts it as a repeat only if GitHub sends the same `X-GitHub-Delivery` value again.
- GitHub's signature covers only the body, not the `X-GitHub-Delivery` ID, and GitHub sends no timestamp. So anyone who captures one valid GitHub request can send it again, now or later, under a new `X-GitHub-Delivery` value: it passes the check and is stored as a new webhook, not counted as a repeat. Only the secret URL and HTTPS stand in the way, so treat a GitHub endpoint's URL as private. Standard Webhooks and Stripe sign a timestamp, so they refuse a replay after 5 minutes.

## How the admin panel is secured

- **Cloudflare Access signs people in.** The panel shows the email of the person signed in, for example `admin@ianmenethil.com`, and records it against each endpoint they create. It comes from the Access sign-in, not from your Cloudflare account.
- **The Worker checks every admin request itself**, so the panel cannot be reached around Access, for example on the `workers.dev` address. The Worker runs first for every `/admin` request, including the panel's own page and files (`run_worker_first` in `wrangler.jsonc`). It accepts Cloudflare's [`ctx.access`](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) when the runtime provides it (local development does; a deployed Worker with static assets does not) or verifies the [Access token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) in `Cf-Access-Jwt-Assertion` against your team's public keys, which Cloudflare caches for five minutes. The token must be for `ACCESS_AUD` and issued by `ACCESS_TEAM_DOMAIN`.
- **The admin API answers only the panel.** It sends no CORS headers, so browsers stop other sites from reading it or sending it JSON. Hono's [`csrf`](https://hono.dev/docs/middleware/builtin/csrf) middleware refuses form-style requests from other sites. Its answers carry `Cache-Control: no-store`.
- **The panel's pages carry security headers** from Hono's [`secureHeaders`](https://hono.dev/docs/middleware/builtin/secure-headers), including a Content Security Policy that allows only its own script (inline styles are allowed for shadcn's toast and dialog), and `X-Frame-Options: DENY` so no other page can show the panel in a frame.
- **Signing secrets never leave the database through the API.** The admin API does not return them when it creates or lists endpoints.

## What the Worker answers

Senders post to `POST /hooks/<token>`. The Worker answers in this order: token shape, rate limit, size, token lookup, signature.

| Request | Response |
| --- | --- |
| `POST /hooks/<token>` accepted | `200` with `{"received":true,"duplicate":false}`; `duplicate` is `true` when the event was stored before |
| Missing or wrong signature, missing signature header, or a timestamp more than 5 minutes off (Standard Webhooks and Stripe) | `401` with `{"error":"..."}`; nothing is stored |
| A token that is not 43 URL-safe characters (letters, digits, `-` and `_`), an unknown token, or any method other than `POST` | `404` |
| Body over 1 MB (1,048,576 bytes), also when it is streamed without a `Content-Length` | `413` |
| More than 300 requests a minute to one endpoint's URL, from all senders together | `429` |
| An unexpected error in the Worker, for example D1 not answering | `500` |
| `GET /` | `302` to `/admin/` |
| `/admin` without a Cloudflare Access sign-in | `401`, or `403` until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set |

Every error answer is JSON in the form `{"error":"..."}`, including the `/admin` sign-in answers above, a refused cross-site request, malformed JSON and an `/admin/api` path that does not exist.

The admin API is for the panel; it works only with an Access sign-in and from the panel's own pages.

| Request | What it does |
| --- | --- |
| `GET /admin/api/me` | The signed-in email and `BRAND_NAME` |
| `GET /admin/api/endpoints` | All endpoints, newest first, with their URL, webhook count and latest delivery time |
| `POST /admin/api/endpoints` | Creates an endpoint from `{name, format, secret}`: `201`, `400` for a bad name, format or secret, `409` when the name is taken. `format` is `none`, `standard`, `stripe` or `github`; `secret` is required except for `none` |
| `DELETE /admin/api/endpoints/:id` | Deletes the endpoint and all its webhooks: `204` |
| `GET /admin/api/webhooks` | Webhooks newest first, 50 at a time, without headers and body. Optional `endpoint=<id>`, `q=<text>` (matches event ID or body, up to 100 characters) and `before=<nextBefore of the previous answer>` |
| `GET /admin/api/webhooks/:id` | One webhook with its headers and body; `404` when unknown |
| `DELETE /admin/api/webhooks/:id` | Deletes one webhook: `204` |

## Limits and things to know

- **The rate limit is approximate.** Cloudflare counts per location, so senders reaching different locations are counted separately, and bursts can go over the limit. See the [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). The limit is per endpoint, not per sender address: many senders can share one address. A token that is not shaped like the ones this Worker makes gets `404` before the limiter and the database see it; a well-formed token that no endpoint has still counts. The limiter does not slow down guessing a token: that rests on tokens being 256 random bits.
- **Signatures are checked on the exact bytes received**, as Standard Webhooks, Stripe and GitHub require, and only then is the body stored as UTF-8 text. A leading byte order mark is kept. Bytes that are not valid UTF-8 are stored as the replacement character, so the stored text can differ from what was sent, while the size shown is always the real number of bytes. Binary payloads are not supported.
- **Signing secrets are stored in D1 as plain text.** The Worker needs them to check signatures, so they cannot be hashed. Anyone who can read your D1 database can read them, so restrict access to your Cloudflare account. Secrets are never returned by the admin API.
- **Credential headers are replaced with `[redacted]`** before a webhook is stored: `authorization`, `proxy-authorization`, `cookie`, and any header whose name contains `token`, `secret`, `api-key` (also `api_key` or `apikey`) or `password`, such as `x-api-key` or `x-gitlab-token`. Other headers are stored as received, so a sender's credential in a header with another name would be stored.
- **Workers Logs record the endpoint URLs.** `observability.enabled` in `wrangler.jsonc` turns on [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), whose entry for each request carries the method and the full URL, and that URL contains the endpoint's secret token. For an endpoint with format **None** the token is the only protection, so anyone who can read your Worker's logs can post to it. Prefer a signed format whenever the sender supports one, or set `observability.enabled` to `false`.
- **Retention.** The daily job runs at 03:00 UTC and deletes webhooks whose latest delivery is older than `RETENTION_DAYS`. A webhook delivered again keeps its place for another full period. Endpoints are not deleted.
- **Storage is D1.** Each stored webhook is one row, and D1 has [size limits](https://developers.cloudflare.com/d1/platform/limits/): 2 MB for a row and 500 MB for a database on the Free plan, 10 GB on Workers Paid (as listed in November 2026). A short retention keeps the database small.
- **Delivery is acknowledged only after the webhook is stored.** If D1 is unavailable, the Worker answers an error and the sender retries. Nothing is processed in the background.

## Develop locally

Requires Node.js 22 or later and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: uncomment the `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` lines so the admin panel opens locally. They match the signed-in user `admin@ianmenethil.com` that `access.dev` in `wrangler.jsonc` simulates. They are commented out in `.dev.vars.example` because Deploy to Cloudflare reads the [Worker secrets](https://developers.cloudflare.com/workers/platform/deploy-buttons/) from that file in [dotenv format](https://hexdocs.pm/dotenvy/dotenv-file-format.html), where a line starting with `#` is a comment and so is skipped. These two are `vars` in `wrangler.jsonc`, not secrets.

Then run `pnpm run dev` and open the address Vite prints, usually `http://localhost:5173/` (a different port if 5173 is busy). The root redirects to the panel at `/admin/`. To send a test webhook, create an endpoint in the panel and post to the URL it shows.

| Script | What it does |
| --- | --- |
| `pnpm run dev` | Applies the migrations to a local D1 database, then runs the Vite dev server with the Worker, the local database, a local rate limiter and a simulated Access user; the panel reloads as you edit |
| `pnpm run build` | Type-checks everything and builds the panel and the Worker into `dist/` |
| `pnpm run preview` | Builds, then serves the production build locally |
| `pnpm test` | Builds the panel, then runs the tests inside the Workers runtime |
| `pnpm run lint` | Runs ESLint (TypeScript, React hooks and TSDoc rules); any warning fails it |
| `pnpm run check` | Builds, lints and does a dry-run deploy with Wrangler |
| `pnpm run cf-typegen` | Regenerates `worker-configuration.d.ts` after a `wrangler.jsonc` change |
| `pnpm run db:migrate` | Applies the migrations to the deployed database (`wrangler d1 migrations apply DB --remote`) |
| `pnpm run db:migrate:local` | Applies the migrations to the local database |
| `pnpm run deploy` | Builds, applies the migrations to the deployed database, then deploys with Wrangler |

## Deploy by hand

Use this instead of the Deploy to Cloudflare button, from a checkout of your copy, after `pnpm install` and `pnpm exec wrangler login`.

The very first time, do not start with `pnpm run deploy`. `wrangler.jsonc` names the database (`webhooks`) but has no `database_id` yet, so the migration step cannot find it and stops with this message from Wrangler:

```
Couldn't find a D1 DB named 'webhooks' (bound as 'DB') in the API. Run 'wrangler d1 create webhooks' to create it.
```

Deploy once with Wrangler, which creates a database with that name when the binding has no ID, then use the script:

```bash
pnpm run build
pnpm exec wrangler deploy
pnpm run deploy
```

The second command provisions the database and deploys the Worker, whose tables do not exist yet. The third applies `migrations/` and deploys again; run it straight away. In an interactive terminal Wrangler may also write the new `database_id` into `wrangler.jsonc`, which you can keep or discard: later deploys find the database either way. Every deploy after the first is just `pnpm run deploy`.

## Project layout

This follows Cloudflare's [React + Vite + Hono template](https://github.com/cloudflare/templates/tree/main/vite-react-template).

```
admin/index.html     The admin panel's page, served at /admin/
migrations/          The D1 tables, as SQL files that `wrangler d1 migrations apply` runs in order
src/react-app/       The admin panel: React components (components/ui/ holds the shadcn/ui ones, trimmed to what the panel uses), the theme provider, API calls, the text for each signature format, and index.css with Tailwind and the theme colours
components.json      shadcn/ui settings: `pnpm dlx shadcn@latest add <component>` writes into src/react-app/components/ui/
src/worker/          The Worker (Hono): index.ts wires the routes in routes/ to the helpers in lib/ (Access check, endpoints, signatures, rate limit, storing webhooks) and runs the daily clean-up
src/shared/          The admin API's types, used by both
test/                Tests that run inside the Workers runtime
vitest.config.ts     Test settings: the Workers runtime, the migrations, and fixed test values for Access
wrangler.jsonc       Bindings (D1, rate limiter), variables, the Cron Trigger and static assets settings
.dev.vars.example    Template for the local `.dev.vars`
eslint.config.js     ESLint rules: TypeScript, React hooks and TSDoc
.github/workflows/ci.yml  CI: audit, generated types, `pnpm run check` and the tests
```

## License

[MIT](./LICENSE)
