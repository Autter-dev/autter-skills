# Request summaries setup

Read this when wiring or upgrading a Node.js, Next.js or edge service. Request
summaries fill **Runtime → Requests & logs → Requests** and **Routes**. Without
them those views stay empty even when traces, metrics and operation logs work.

They require `@autter/runtime-node` / `@autter/runtime-next` **1.5.0+** (or
`@autter/runtime-edge` **1.0.0+**) and an ingester at **1.5.0+** with migrations
`0012-runtime-logs-requests` and `0014-runtime-request-1m`. 1.4.0 code keeps
working unchanged after the upgrade. Wiring the middleware is a default setup
step, not an opt-in: do it for every HTTP service you instrument.

## Check capability first

1. Ingester: `curl -s "https://otlp.autter.dev/v1/compat?features=request_summaries"`
   (or the self-hosted URL the user gave). `available: true` on the
   `request_summaries` feature means it is ready. A `404` means the ingester
   predates 1.5.0: wire the SDK anyway (older ingesters accept and ignore the
   fields), and report the Requests view as pending an ingester upgrade.
2. SDK: inspect the **installed** package (the lockfile or
   `node_modules/@autter/runtime-node/package.json`), not the range in
   `package.json`. Upgrade with the project's package manager to `^1.5.0` and
   commit the lockfile. `npx @autter/runtime-node doctor` reports SDK,
   ingester and feature status in one shot; it exits non-zero on a mismatch.
3. `.gitignore`: 1.5.0 writes local NDJSON records to `.autter/runtime/` when
   `NODE_ENV=development`. Add `.autter/` to `.gitignore` if it is missing.

## Wire the request boundary

Pick the entry point from the framework you found. Mount it once per app,
before the routers, so every route runs inside the request context.

| Framework | What to add |
| --- | --- |
| Express / Connect | `app.use(autterRequests({ ignore }))` before routers |
| NestJS (Express adapter) | `app.use(autterRequests({ ignore }))` in `main.ts` before `app.listen` |
| Fastify 4/5 (incl. NestJS Fastify adapter) | `app.register(autterFastify, { ignore })` before routes |
| Hono on Node, Remix, fetch-style `Request → Response` handlers | wrap the handler: `withRuntimeRequest(handler, { ignore })` |
| Next.js App Router route handlers | `export const GET = withRuntimeRequest(handler)` from `@autter/runtime-next/server`, in every `app/**/route.ts` |
| Next.js `middleware.ts`, Cloudflare Workers, Vercel Edge, Deno, Bun | `withAutter` from `@autter/runtime-edge` (Next: `@autter/runtime-next/edge`) |
| Koa, plain `node:http`, anything else | no stable middleware. Report request summaries as pending. Offer `logging: { requests: true }` only if the user accepts an experimental hook (it can leak context under keep-alive) |

```js
const { autterRequests } = require("@autter/runtime-node");

const app = express();
app.use(autterRequests({ ignore: ["/healthz", "/readyz", "/metrics"] }));
app.use(express.json());
// … existing routers …
```

```ts
// app/api/checkout/route.ts (Next.js, Node runtime)
import { withRuntimeRequest } from "@autter/runtime-next/server";

export const POST = withRuntimeRequest(async (request: Request) => {
  // existing handler body, unchanged
}, { name: "checkout" });
```

- **Ignore probes.** Summaries are always kept; there is no sampler. Add the
  repo's health, readiness, metrics and static-asset paths to `ignore`
  (`*` = one segment, `**` = any depth). Find them in the router, the
  Dockerfile `HEALTHCHECK`, and load balancer or Kubernetes probe config.
- **Keep existing behavior.** The middleware only reads the request, sets the
  `x-request-id` response header and emits a record when the response
  finishes. Do not reorder auth, CORS or body parsers to fit it in. Put it as
  early as possible without changing them.
- **One boundary per request.** If a handler already wraps the whole request
  in `withRuntimeOperation` or `withProcessSpan`, keep that wrapper (it
  becomes a child operation linked to the summary) and still add the request
  middleware. Do not wrap a Next.js handler twice.
- **Next.js handlers.** Wrap each exported method (`GET`, `POST`, …) in every
  App Router `route.ts`, keeping the original function body unchanged. Skip
  the browser relay route (`createAutterRelayRoute`), which is already
  handled. Pages Router API routes, server actions and page renders are not
  covered by `withRuntimeRequest`; list them in the hand-off as uncovered.
  Use `name` only when the path has a dynamic segment you want named
  explicitly; otherwise ids in the path are normalized to `:id`.
- **Apps with their own OTel SDK.** Use `initAutterLogging` instead of
  `initAutterServer` so a second NodeSDK is never started; the request
  middleware works the same way. Never call both.

## Error responses (ask first)

`autterErrorResponse()` (Express, mounted last) and `toClientError(err,
requestId)` (Fastify `setErrorHandler`, Next.js handlers, Nest exception
filters) change what clients receive: a JSON body
`{ error: { message, code?, why?, fix?, link?, requestId? } }` and the
error's own status. Do not add them automatically:

- If the app already has an error handler, keep it. A thrown error or a
  status of 500 or more already marks the summary `failed`, without any change
  to responses.
- If it has none and is a JSON API, offer `autterErrorResponse()` as an
  improvement and add it only with the user's go-ahead.
- To surface the request id without changing response shape, include
  `runtimeContext.requestId` in the existing error body or support page.

## Context and coded errors (optional, while you are there)

`runtimeContext.set({...})` attaches bounded context to the current request
summary from anywhere in its call tree; `runtimeContext.info/warn` fold
messages into it. Use these where the operation-logging reference already
calls for context. Existing error classes with a stable `code`, `status` and
`expected` are picked up without a rewrite. Do not invent a catalog of coded
errors during setup; that is product work the user should ask for.

## Verify

Use the style skill's temporary selftest, which runs through the request
middleware, and only in an isolated environment:

1. The selftest response carries an `x-request-id` header. Record it.
2. The summary is emitted when the response finishes, so the handler's own
   `flushRuntimeLogs()` does not include it. The SDK's log timer sends it about
   two seconds later, and a graceful shutdown also flushes it. On Next.js,
   `after()` delivers it.
3. **Runtime → Requests & logs → Requests**: search the request id with the
   "Find request id" box. Expect one `GET /__autter-selftest` summary with
   status, duration, outcome and the selftest's child operations. Self-hosted:
   `SELECT route, status_code, outcome, request_id FROM autter_runtime.runtime_logs
   WHERE kind = 'request' ORDER BY occurred_at DESC LIMIT 10`.
4. **Routes** shows the route after the per-minute rollup runs.
5. An empty Requests view with stored operation logs means the middleware is
   not mounted ahead of the route, the path matched `ignore`, or the SDK
   resolved to an older version. An unavailable view means the ingester is
   older than 1.5.0.

Reference: [Requests, coded errors and background work](https://github.com/Autter-dev/autter-runtime/blob/main/docs/REQUESTS-AND-ERRORS.md).
