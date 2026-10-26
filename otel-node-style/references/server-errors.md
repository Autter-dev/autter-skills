# Server errors setup

Read this when wiring or upgrading a Node.js, Next.js or edge service. When a
handler throws, the framework answers 500, and on its own that 500 reaches
Autter as a stackless `HttpServerError` grouped by route. The 1.6.0 error
hooks record the thrown error, with its stack, on the request span, and the
framework then handles it exactly as before. Adding the hook is a default
setup step for every HTTP service.

They need `@autter/runtime-node` / `@autter/runtime-next` **1.6.0+**
(`@autter/runtime-edge` **1.1.0+** for `captureEdgeException`). Breadcrumbs
and fingerprint overrides also need ingester **1.6.0+**; older ingesters
ignore those fields. Deploy the ingester before the SDKs.

## Check capability first

1. Published: `npm view @autter/runtime-node version` (and `-next`, `-edge`).
   If 1.6.0 is not published yet, keep the 1.5.0 setup and report server
   error hooks, unhandled-rejection capture and Next.js `onRequestError` as
   pending the 1.6.0 release. Do not add imports the installed package lacks.
2. Installed: check the lockfile or
   `node_modules/@autter/runtime-node/package.json`, not the range. Upgrade
   with the project's package manager to `^1.6.0` and commit the lockfile.
3. Ingester: `curl -s "https://otlp.autter.dev/v1/compat?features=breadcrumbs,fingerprint_override"`.
   A `404` or `available: false` means the error hooks still work, but
   breadcrumbs and fingerprints are dropped until the ingester is upgraded.
   `npx @autter/runtime-node doctor` reports SDK, ingester and feature status
   in one shot.

## Add the framework's error hook

| Framework | Hook and placement |
| --- | --- |
| Express / Connect | `app.use(autterErrorHandler())` after the routes, before the app's own error handlers. It calls `next(err)` unchanged |
| Fastify 4/5 | `app.register(autterFastifyErrors)` or `autterFastifyErrors(app)`: an `onError` hook covering every route. Skip it when `autterFastify` is registered, which already includes it |
| Koa 2/3 | `app.use(autterKoa())` first. It records and rethrows, so `app.on("error")` still fires |
| NestJS, hapi, anything else | `captureRequestError(err, attributes?)` from the framework's existing error hook (a Nest exception filter, hapi `onPreResponse`, …) |
| Next.js | `onRequestError` from `@autter/runtime-next/instrumentation` (below) |

```js
const { autterRequests, autterErrorHandler } = require("@autter/runtime-node");

app.use(autterRequests({ ignore: ["/healthz", "/metrics"] }));
// … existing routers …
app.use(autterErrorHandler());
app.use(existingErrorHandler); // unchanged
```

- **Keep existing handlers.** The hooks never change status codes, bodies or
  logging. Do not reorder or replace the app's error handlers to fit one in.
- **Already covered:** `autterErrorResponse()` reports the same way and also
  answers the request, so an app that mounts it needs no `autterErrorHandler`.
  `autterFastify` includes `autterFastifyErrors`. A middleware from an earlier
  setup that only calls `captureException(err)` and `next(err)` can be
  replaced by `autterErrorHandler()` in the same position.
- **Koa with its own catch-all error middleware** that answers without
  rethrowing: an `autterKoa()` mounted before it never sees the error. Mount
  `autterKoa()` directly after that middleware instead.
- **`captureRequestError` reports every error you pass.** Call it only for
  unexpected failures (status 500 or more, or no status), so validation
  errors and 404s stay out of issues. In NestJS, add it to the existing
  global exception filter. If there is none, extend Nest's base exception
  filter and keep its response behavior, or report the gap rather than
  changing error responses.
- **What is reported.** By default the hooks report errors with status 500
  or more (or none), `RuntimeError`s and coded errors. `ctx.throw(404)` and
  validation failures stay out of issues. Pass `{ capture: true }` to report
  every error, or a predicate; change this only when the user asks.
- **Once per error.** An error is reported once, even if a handler already
  called `captureException`, and it lands on the request's HTTP server span
  even when a child span is active.

## Unhandled promise rejections (default in 1.6.0)

`initAutterServer` and `initAutterLogging` now record unhandled rejections as
errors (`autter.unhandled_rejection: true`, not fatal) without changing
whether the process crashes. With Node's default
`--unhandled-rejections=throw` and no other listener, the SDK rethrows on the
next tick, so the process still exits with code 1 and the crash is recorded
as fatal. An app's own `unhandledRejection` listener still decides.

- Leave it on. Opt out with `captureUnhandledRejections: false` only if the
  user asks; it restores the 1.5.0 behavior, where a rejection is seen only
  when it crashes the process. (`captureGlobalErrors: false` also turns off
  crash capture; do not use it for this.)
- One visible difference: after the rethrow, `uncaughtException` listeners
  receive origin `"uncaughtException"` rather than `"unhandledRejection"`. If
  the app branches on that origin, point it out.

## Next.js

### `next.config`: one SDK copy (required)

The 1.6.0 docs made this a required step, and it applies to 1.5.0 installs
too. Next bundles a separate copy of server dependencies into
`instrumentation.ts` and into each route. Without this, code in routes, server components and
server actions (`withRuntimeRequest`, `captureServerException`,
`runtimeLogger`, `runtimeContext`) uses a copy `registerAutter` never
started: request summaries go to the console instead of the ingester, and
errors are reported twice.

```js
// next.config.mjs: merge into the existing config
export default {
  // existing config
  serverExternalPackages: [/* existing entries */ "@autter/runtime-node"],
};
```

- Merge into an existing `serverExternalPackages` array; never replace it.
- Next 14.2 uses
  `experimental: { serverComponentsExternalPackages: ["@autter/runtime-node"] }`
  instead, merged the same way.
- When the config is wrapped (`withAutterSourceMaps(...)`, other plugins),
  add the key to the inner config object.
- If the build warns that the external package cannot be resolved from the
  project directory (strict installs such as pnpm), add
  `@autter/runtime-node` as a direct dependency at the version
  `@autter/runtime-next` requires, so both resolve to one copy.

### `instrumentation.ts`: `onRequestError` (Next 15+)

Errors Next catches itself, in server components, server actions, route
handlers and middleware, arrive as stackless 500s unless `onRequestError` is
exported. `@autter/runtime-next/instrumentation` is safe to import at the top
of `instrumentation.ts` on both runtimes: edge bundles resolve it to a build
with no Node imports.

```ts
// instrumentation.ts: keep the existing register()
import { autterOnRequestError } from "@autter/runtime-next/instrumentation";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerAutter } = await import("@autter/runtime-next/server");
    registerAutter({ apiKey: process.env.AUTTER_RUNTIME_KEY!, service: "<app name>" /* existing options */ });
  }
}

// Node: recorded on the request span by the registerAutter tracker.
// Edge (middleware, edge pages): sent to /v1/logs with these options.
export const onRequestError = autterOnRequestError({
  edge: { apiKey: process.env.AUTTER_RUNTIME_KEY, service: "<app name>" },
});
```

An app with no edge code can use the shorter form:

```ts
export { onRequestError } from "@autter/runtime-next/instrumentation";
```

- If `instrumentation.ts` already exports `onRequestError` (another error
  tracker), keep it: call both from one exported function and do not drop
  the existing call.
- Recorded with the stack: `next.route_path` (the route template),
  `next.router_kind`, `next.route_type`, `next.render_source`,
  `next.digest` (matches the `digest` an error boundary sees), the method and
  the path without its query string. Headers and cookies are never read.
- A support ticket that quotes the digest (`Digest: 2338492983`) is linked to
  the error. If the app's `error.tsx` shows a custom message, offer to show
  `error.digest` there with that label, with the user's go-ahead.
- Redirects, `notFound()` and Next's other control-flow signals are not
  reported. The `capture` option (`true` or a predicate) changes that; leave
  it unset.
- An error that `withRuntimeRequest` already reported is not reported twice;
  Next's context is added to that report.
- Next never calls the hook inside an edge route handler
  (`export const runtime = "edge"` in `route.ts`). Under `next start` the
  Node server reports those errors instead; on other hosts list them as
  uncovered.
- Next 14 has no `onRequestError`: report server component and server action
  errors as uncovered until the app moves to Next 15.

### Error pages and thrown statuses (1.9.0)

`onRequestError` sees errors on the server. What React shows on an error page
in the browser is reported by the page itself: `useAutterErrorReport(error)`
in each client `error.tsx`, and `reportNextError(error, { boundary:
"global-error" })` in `global-error.tsx` (or `export { AutterGlobalError as
default } from "@autter/runtime-next/client"` when there is none). Each error
is reported once, with `next.error_boundary` and `next.digest`, so it links to
the server-side report of the same digest. `withAutter(handler)` from
`@autter/runtime-next` records a thrown error and answers with its own status
(a thrown 404 stays 404); swapping it for an existing `withRuntimeRequest`
needs the user's go-ahead because the response changes.

Next.js custom servers can also use `autterErrorHandler`,
`autterFastifyErrors`, `autterKoa` and `captureRequestError`, which
`@autter/runtime-next` re-exports.

## Edge: errors outside `withAutter`

`withAutter` already reports errors thrown from the fetch handler. For a
scheduled or queue handler, report with `captureEdgeException(options,
error, attributes?)` from `@autter/runtime-edge` 1.1.0 (or
`@autter/runtime-next/edge`):

```ts
import { captureEdgeException } from "@autter/runtime-edge";

export default {
  async scheduled(event, env, ctx) {
    try {
      await syncAccounts(env); // existing job body
    } catch (error) {
      ctx.waitUntil(captureEdgeException({ apiKey: env.AUTTER_RUNTIME_KEY, service: "<worker name>" }, error,
        { "job.name": "sync-accounts" }));
      throw error; // keep the job's existing failure behavior
    }
  },
};
```

It sends one error record to `/v1/logs`, never rejects, and skips an error
`withAutter` already reported.

## Caught errors and deliberate fallbacks (1.9.0)

From runtime-node/next 1.9.0 (runtime-edge 1.4.0) an `Error` passed to
`console.error`, pino, winston, bunyan or `runtimeLogger.error` becomes an
occurrence marked `autter.handling: "caught"`, with the log line as context.
It never fails the request and stays out of the error rate; a burst limit per
error kind keeps ten at once, then one every ten seconds, and counts the rest.
`captureLoggedErrors: false` turns it off, `{ console: false }` keeps loggers
only. A `catch` that falls back on purpose calls
`runtimeContext.degraded(err, reason)` (edge: `rt.degraded`): a `warning`
occurrence marked `autter.handling: "deliberate"` that never pages, and the
request ends `degraded`. Below 1.9.0 use `runtimeContext.error(err)` and
`runtimeContext.outcome("degraded", reason)`.

## Server breadcrumbs (1.6.0)

Inside `autterRequests()`, `withRuntimeRequest()` or
`withRuntimeOperation()`, every `runtimeLogger` and
`runtimeContext.debug|info|warn|error` entry is recorded as a `log`
breadcrumb, and the last 30 are attached to captured exceptions as
`autter.breadcrumbs`. No setup is needed beyond the request boundary.
`addBreadcrumb({ message, data })` adds a custom step: use it sparingly, at a
few meaningful workflow steps, with fixed messages and at most 10 primitive
data values. Logger-only mode (`initAutterLogging`) and
`@autter/runtime-edge` do not attach breadcrumbs yet.

## Fingerprint override (optional)

Offer this only to teams that want custom grouping:
`captureException(err, { fingerprint: ["checkout", "card-timeout"] })` (a
string or up to 10 strings of at most 200 characters) groups every error
that carries it into one issue. The edge equivalent is
`rt.captureException(err, { fingerprint })`. Use stable values, never ids or
user data. Needs ingester 1.6.0+.

## Verify

Only in an isolated environment, through the style skill's temporary
`/__autter-selftest/error` route:

1. The route answers with the app's usual 500 response, unchanged.
2. The issue for `autter selftest server error` shows the thrown `Error`
   type, message and stack, not a stackless `HttpServerError` for the route,
   and it appears once.
3. With operation logging wired, the issue's breadcrumbs include the
   selftest's `runtimeLogger` entry.
4. Next.js: the temporary route handler's error shows `next.route_path` and
   its stack. An error reported twice, or request summaries printed to the
   console instead of stored, means `serverExternalPackages` is missing or
   not merged.
5. Remove the temporary route.

Reference: [Stack integrations](https://github.com/Autter-dev/autter-runtime/blob/main/docs/INTEGRATIONS.md).
