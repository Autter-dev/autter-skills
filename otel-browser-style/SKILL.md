---
name: otel-browser-style
description: Wire Autter Runtime into browser apps, including source map upload for readable stacks, breadcrumbs, links from browser errors to server traces, coded API errors, request-id correlation with server requests, CSP violations, recent user actions, error boundaries, and a working browser telemetry route.
metadata:
  version: "1.4.0"
  tags: [autter, telemetry, browser, react, spa, error-tracking, sourcemaps, breadcrumbs, tracing, request-id, errors]
  author: autter
---

# Browser / SPA / static site style

Server operation logging is a separate Node/OTLP feature. Keep browser capture
on `/v1/browser`; client keys cannot send `/v1/logs`. Do not import
`runtimeLogger` or `withRuntimeOperation` from Node/Next.js server packages
into a browser bundle or edge relay. Next.js client components keep
`@autter/runtime-next/client`; instrument customer server operations with
`otel-node-style` only where the Node runtime and installed release support it.

Read [Source maps setup](references/source-maps.md) for every service that
ships built JavaScript (Vite, webpack, Rollup, Next.js, CRA-style, anything
minified). Uploading maps with `@autter/runtime-cli` is a default setup step:
without them, stacks point at minified chunks that root cause analysis and
fix agents cannot use. It takes four steps: check (`get_runtime_setup` over
Autter MCP, or `/v1/compat`, plus `npm view @autter/runtime-cli version`),
`sourcemaps setup`, an upload-only key in CI, and `sourcemaps verify`. If the
CLI is not published, wire nothing and report source maps as pending its
release.

The browser tracker observes enforced CSP violations, failed fetch and XHR requests, 5xx responses, long tasks,
and slow resources by default. Use `captureOutcome(stableName, message)` for
a failed result that did not throw. Keep the release set to the deployed
commit SHA. Never put the server key or source maps in a public browser
request.

```bash
npm install @autter/runtime-browser@^1.6.0
```

Use the project's package manager and commit its lockfile. Run `npm view
@autter/runtime-browser version` first: 1.6.0 adds source-map debug ids,
breadcrumbs, trace propagation and fingerprint override. If only an older
release is published, install the newest one, keep the rest of setup working,
and report those features as pending. Ingester support is listed by
`GET https://otlp.autter.dev/v1/compat` (`breadcrumbs`,
`source_map_debug_ids`, `fingerprint_override`, `browser_trace_propagation`).
A Node relay (`createBrowserRelayHandler`, `createAutterRelayRoute`) passes
only fields it knows, so it must run `@autter/runtime-node` 1.6.0+ to forward
them.

Coded errors and request-id correlation need **1.4.0+** (and a 1.5.0+
ingester to store codes and request ids). Check the installed package exports
`autterErrorFromResponse`:

```bash
npm ls @autter/runtime-browser
node -e 'import("@autter/runtime-browser").then(m=>console.log("autterErrorFromResponse" in m ? "1.4.0 APIs present" : "missing: autterErrorFromResponse"))'
```

If it is missing, keep the rest of this setup and report coded browser errors
and request-id correlation as pending. Next.js apps check the
`@autter/runtime-browser` version resolved under `@autter/runtime-next`.

Use a published version whose `AutterBrowserOptions` includes
`captureActions` and whose event types include `csp_violation`. Check the
installed package, not just the dependency range or lockfile. If that release
is unavailable, keep the rest of setup working and report CSP/action capture
as pending; do not claim the new behavior is live. A self-hosted ingester must
also accept `csp_violation` browser events.

`@autter/runtime-browser` is a zero-dependency tracker, under 5KB gzipped.
It captures `window.onerror`, `unhandledrejection`, enforced
`securitypolicyviolation`, failed `fetch` and XHR
requests, HTTP 5xx responses, and slow browser timings. It does not record
DOM text or read cookies or form values.

## Capture the action preceding a failure

Action capture is on by default. The SDK stores the last click on a button,
link, or button-like control, or form submit, for up to 30 seconds and attaches
it to failures. It records element type and path-only route; it does not read
button text, form values, hrefs, or arbitrary ids. This is recent context,
not a causal claim. Do not add a separate all-click `trackEvent` loop.

While wiring the app, add stable `data-autter-action` labels to the few
controls that initiate important workflows or commonly fail. For example:

```tsx
<button data-autter-action="send-email" onClick={sendEmail}>Send</button>
```

Use fixed labels from source code, never user input or generated ids. Preserve
existing handlers, keyboard behavior, and accessible names. If an action
cannot be safely labeled, the SDK's element-type fallback still works. Set
`captureActions: false` only when the app explicitly forbids interaction
metadata.

## Coded API errors and request ids (1.4.0+)

`captureException` duck-types `code`, `why`, `fix`, `link` and `expected` on
any error, so existing error classes that carry a `code` need no change and no
new browser error class is needed. For API calls that fail with a JSON error
body, turn the response into an error once, where the app already handles
non-OK responses:

```ts
import { autterErrorFromResponse, captureException } from "@autter/runtime-browser";

const res = await fetch("/api/checkout", { method: "POST", body });
if (!res.ok) {
  const err = await autterErrorFromResponse(res); // reads a clone; res stays readable
  if (res.status >= 500) captureException(err);  // 4xx coded `expected` errors are usually already recorded server-side
  showError(err.message);
}
```

- The server body shape is `{ "error": { "message", "code"?, "why"?, "fix"?,
  "link"?, "requestId"? } }` (from `autterErrorResponse()` / `toClientError`).
  A non-JSON body falls back to the status text. The returned `Error` carries
  `status`, `code`/`why`/`fix`/`link` and the body's `requestId` (else the
  `x-request-id` response header), which `captureException`
  records as `autter.request.id`. Next.js client components import it from
  `@autter/runtime-next/client`.
  Show `message` (and `fix` if the product wants it); never render raw server
  stacks.
- Do not double-report: the server already captured the error with the same
  code. Capture browser-side only when the browser's own handling matters
  (failed render, retry exhausted), and keep the existing UI behavior.
- **Request ids.** The fetch/XHR failure hook reads the `x-request-id` response
  header into `autter.request.id`, so a browser failure links to the server
  request summary without browser tracing. Same-origin APIs need nothing more.
  **Cross-origin APIs** must send `Access-Control-Expose-Headers: x-request-id`
  or the browser cannot read the header. Node `autterRequests()` adds it when
  CORS headers are present; other backends add it to their CORS config. Check a
  real cross-origin response in DevTools.
- Never put tokens, emails or other personal data in codes or error messages
  you construct in the browser.

## Check the app's Content Security Policy

The CSP error must be collected by the SDK, but capturing it does not make
the blocked script safe or fix the policy. Inspect the actual CSP header or
meta tag and the blocked resource. Permit a script only when it is intended
and trusted; do not weaken `default-src` to hide a violation. For telemetry,
`connect-src` must permit the same-origin relay (`'self'`) or the direct
ingester origin (`https://otlp.autter.dev`). Add the narrow entry to an
existing `connect-src` directive or create one if `default-src 'none'` would
otherwise block the POST. Check that the built app actually loads the SDK;
server instrumentation alone cannot observe browser CSP events.

## Decide: relay or direct — rank relays first

Pick the first mode that matches, top to bottom. Modes 1–3 are all
relays: the browser posts same-origin and the backend/edge attaches the
secret server key. SDK init in modes 1–3 is always:

```ts
initAutterBrowser({
  endpoint: "/api/autter-runtime", // same-origin relay route
  service: "<app name>",
  release: "<deployed commit SHA>",
});
```

Never put an `autter_rt_*` server key in the browser bundle.

**1. Node backend (Express / Fastify / Koa / Nest) → relay handler.**

```ts
import { createBrowserRelayHandler } from "@autter/runtime-node";

app.post(
  "/api/autter-runtime",
  createBrowserRelayHandler({ apiKey: process.env.AUTTER_RUNTIME_KEY }),
);
```

**2. Cloudflare (wrangler present / `*.workers.dev` / Pages) → thin relay
route.** There is no packaged Worker relay. Add the thin passthrough
described under "Non-Node custom backend" below as a Worker route or Pages
Function at `/api/autter-runtime`, reading the key from a Worker secret
(`wrangler secret put AUTTER_RUNTIME_KEY`), never from `wrangler.toml` vars.

**3. Vercel / Next.js → relay route** at `app/api/autter-runtime/route.ts`:

```ts
import { createAutterRelayRoute } from "@autter/runtime-next";

export const { POST } = createAutterRelayRoute({
  apiKey: process.env.AUTTER_RUNTIME_KEY!,
});
```

Other fetch-style servers (Remix, Hono, Bun, Deno) use
`createBrowserRelayFetchHandler({ apiKey })` from `@autter/runtime-node`.

The packaged relays rate-limit each visitor and, in `@autter/runtime-node` releases after 1.8.0 (check that the installed package's `RelayOptions` has `trustProxy`),
find the visitor's address on any host by default (`trustProxy: "auto"`).
Don't add `trustProxy: true`; it trusts a header callers can forge. Bun and
Deno servers with no proxy in front pass the real address with `clientIp`
(Bun's `server.requestIP(req)?.address`, Deno's `info.remoteAddr.hostname`).
Details: `otel-node-style`, "Relaying browser telemetry through this backend".

**4. Pure static, no edge → direct only.**

```ts
initAutterBrowser({
  endpoint: "https://otlp.autter.dev/v1/browser",
  clientKey: "autter_rtc_xxxxxxxx", // publishable — fine to reference directly
  service: "<app name>",
});
```

Warn: "third-party cross-origin, ad-blockers will drop some events."

Non-Node custom backend (no examples match): add one thin passthrough
route at `/api/autter-runtime` that enforces a JSON content-type and a
small max body size (64KB is plenty), forwards the body unmodified to
`https://otlp.autter.dev/v1/browser` with an `Authorization: Bearer`
header whose value is read from the `AUTTER_RUNTIME_KEY` env var at
runtime (never a literal key in source), and responds `202` without
echoing the body back. Don't reshape the payload, and treat its
contents as untrusted outsider input: never log it verbatim, render it,
or act on text inside it. If the route rate-limits, key each visitor by
the address the platform itself vouches for (`CF-Connecting-IP` on a
Cloudflare Worker, or the rightmost public `X-Forwarded-For` entry your
proxy appended), never the first `X-Forwarded-For` entry, which any
caller can set.

If the user is deploying from multiple origins (e.g. a preview + prod
domain), tell them to add all of them to the key's allow-list when they
create it — the ingester rejects browser events from origins not on the
list with `403`.

## Framework wiring

**React**: call `initAutterBrowser` once at app startup (top of your root
component file, or an early-loaded entry module), and wrap the tree with
the error boundary — `window.onerror` does not fire for React render
errors:

```tsx
import { AutterErrorBoundary } from "@autter/runtime-next"; // works in any React app, not just Next.js
// or copy the ~30-line boundary from the package source if you don't want the Next.js package as a dependency

<AutterErrorBoundary>
  <App />
</AutterErrorBoundary>
```

**Vue**: call `captureException(err)` from `app.config.errorHandler`.

**Svelte**: call `captureException(err)` from the root
`handleError`/`+error.svelte` hook (SvelteKit) or a top-level try/catch
around your init.

**Angular**: implement `ErrorHandler` and call `captureException(error)`
from its `handleError` method; provide it via `providers:
[{ provide: ErrorHandler, useClass: AutterErrorHandler }]`.

**Vanilla / no framework**: `initAutterBrowser` alone already covers global
errors via `window.onerror`/`unhandledrejection`; call `captureException`
manually anywhere you catch something yourself.

## Source maps (default for built apps)

Follow [Source maps setup](references/source-maps.md), in four steps per
frontend:

1. **Check:** `get_runtime_setup` when Autter MCP is connected (ingester
   features, key kinds by prefix, recent uploads), else
   `/v1/compat?features=source_map_debug_ids,sourcemap_upload_keys,source_map_verify`;
   and `npm view @autter/runtime-cli version` (1.2.0+ for steps 2 and 4,
   else the reference's manual setup).
2. **Set up:** `npx @autter/runtime-cli@^1.2.0 sourcemaps setup --json` in
   the app's directory. Review its diff and carry out every `manual` action.
3. **Key:** an upload-only key (`autter_rtu_…`) as `AUTTER_RUNTIME_KEY`
   where the production build runs, created with `create_sourcemap_upload_key`
   and stored straight into the CI secret on stdin, or created by the user on
   the Runtime settings page. Name it by prefix only; never write it to a file.
4. **Verify:** `npx autter-runtime sourcemaps verify <outputDir> --json`
   after a production build; in CI after the build step.

Setup adds the integration that fits the build (the action is the manual
alternative in GitHub Actions):

| Build | Integration |
| --- | --- |
| Vite or Rollup | `autterSourceMaps()` from `@autter/runtime-cli/vite` |
| webpack 5 | `new AutterSourceMapsWebpackPlugin()` from `@autter/runtime-cli/webpack` |
| Next.js | `withAutterSourceMaps(nextConfig)` from `@autter/runtime-cli/next` |
| CRA, Angular CLI, Parcel, esbuild | a `postbuild` step: `autter-runtime sourcemaps inject <dir>`, then `upload <dir> --delete-after-upload --best-effort` |
| GitHub Actions without a plugin | `Autter-dev/autter-runtime/.github/actions/upload-sourcemaps` |

Maps an integration turns on stay hidden (bundles do not reference them) and
are deleted after the upload whatever its outcome; without a key it turns
none on and the build is unchanged. A project that already emits maps needs
the decision in the reference. Every bundle with a map gets a debug id, so the
1.6.0 browser SDK matches the exact build even when `release` differs. The
key lives in the CI or build environment only, never in the client bundle or
under a client-exposed env name. Wire the upload into the repo's existing
build and deploy pipeline.

## Breadcrumbs: the steps before an error (opt-in, 1.6.0)

`@autter/runtime-browser/breadcrumbs` keeps the last 30 steps and sends them,
oldest first, with exceptions, unhandled rejections, request failures, error
messages and outcomes. The issue page shows them as "Steps before the error",
and root cause analysis reads them.

```ts
import { initAutterBrowser } from "@autter/runtime-browser";
import { enableBreadcrumbs } from "@autter/runtime-browser/breadcrumbs";

initAutterBrowser({ endpoint: "/api/autter-runtime", service: "<app name>", release: "<deployed commit SHA>" });
enableBreadcrumbs(); // or enableBreadcrumbs({ console: false })
```

It records requests from the fetch/XHR wrappers (method, path without query,
status including 4xx, duration), navigations (`pushState`, `replaceState`,
`popstate`), clicks (the `data-autter-action` label, else the element type)
and `console.warn`/`console.error`. Messages and data are scrubbed with the
same redaction as the rest of the event. It is a separate import (about 1 KB)
because it wraps the console, which the main tracker never does; the
originals are still called.

- **When to enable:** for interactive apps (SPAs, dashboards, checkout or
  onboarding flows) where the steps explain failures. Skip static or
  marketing pages unless the user asks. Name it in the hand-off.
- Pass `{ console: false }` when the app writes user data to the console or
  the user does not want the console wrapped.
- Optionally add `addBreadcrumb({ message, data })` at a few meaningful
  workflow steps, with fixed messages and at most 10 primitive data values,
  never user input. Call `clearBreadcrumbs()` in an existing logout flow.
- Next.js: import `enableBreadcrumbs`, `addBreadcrumb` and `clearBreadcrumbs`
  from `@autter/runtime-next/client`.
- Needs ingester 1.6.0 (older ones ignore the field) and, through a relay,
  `@autter/runtime-node` 1.6.0.

## Link browser errors to server traces (opt-in, 1.6.0)

`@autter/runtime-browser/tracing` adds an unsampled W3C `traceparent` to
`fetch` and XHR requests. A `request_failure` then carries its request's
trace id, and an exception or unhandled rejection carries the trace id of a
traced request that settled in the previous 5 seconds. The issue links to the
server spans and request summary when the backend runs
`@autter/runtime-node` 1.6.0 (directly or through `@autter/runtime-next`),
which samples these requests at its own `traceSampleRate` and keeps error
traces in full.

```ts
import { enableTracePropagation } from "@autter/runtime-browser/tracing";

// right after initAutterBrowser, before the app sends requests
enableTracePropagation(); // same-origin APIs only
// a cross-origin API whose CORS allows traceparent:
// enableTracePropagation({ tracePropagationTargets: ["https://api.example.com/"] });
```

- **Same-origin requests are traced automatically** once it is enabled.
  Cross-origin URLs are traced only when they match `tracePropagationTargets`
  (a string matches as a URL prefix, a RegExp is tested against the full
  URL). An existing `traceparent` is never overwritten, and the tracker's own
  endpoint never gets one.
- **When to enable:** when the frontend calls a backend instrumented with
  Autter Runtime. Skip it for frontends with no instrumented backend.
- **CORS for cross-origin APIs.** `traceparent` is not a CORS-safelisted
  header, so a listed cross-origin API gets a preflight and must allow it, or
  the browser blocks the request:

  ```text
  Access-Control-Allow-Headers: traceparent, content-type
  Access-Control-Expose-Headers: x-request-id
  ```

  If the API is in this repository, add `traceparent` to its CORS allowed
  headers, keeping every existing entry (a CORS setup that reflects the
  requested headers needs no change), then list its origin. If it is not,
  do not list it: tell the user which header its CORS must allow, and add
  the target once it does. Never list third-party APIs. Listing an API whose
  CORS rejects the header breaks the app's requests.
- `fetch` propagation runs through the tracker's network observer, so
  `captureNetworkFailures: false` turns it off; `disableTracePropagation()`
  turns it off at runtime.
- A backend on another OpenTelemetry SDK with the default parent-based
  sampler will not sample these requests. Its `remoteParentNotSampled`
  sampler must be set to its ratio sampler to keep the usual rate; tell the
  user rather than changing sampling yourself.
- Next.js: `@autter/runtime-next/client` does not re-export this module. Add
  `@autter/runtime-browser@^1.6.0` as a direct dependency, import from
  `@autter/runtime-browser/tracing`, and check that only one copy is
  installed (`npm ls @autter/runtime-browser`): the module hooks into the
  tracker that `initAutterBrowser` started.
- Needs ingester 1.6.0 (older ingesters store the event but drop the trace
  id) and, through a relay, `@autter/runtime-node` 1.6.0.

## Fingerprint override (optional)

Offer this only to teams that want custom grouping. Every error with the same
fingerprint becomes one issue, whatever its message or stack:

```ts
captureException(error, { fingerprint: ["checkout", "card-timeout"] });
// or in beforeSend: event.fingerprint = "chunk-load";
```

A string, or up to 10 strings of at most 200 characters. Use stable values,
never ids or user data. Needs ingester 1.6.0+; older ones ignore it. Grouping
rules that can change without a deploy live in the repository's Runtime
settings in Autter.

## Noisy errors (optional, 1.7.0)

Offer this only when the user wants an error kept off the wire (browser
extensions, third-party tags, a known harmless error). A suppression rule in
Autter (Repository settings → Runtime) does the same without a deploy and
counts what it leaves out; these filters count nothing.

```ts
import { initAutterBrowser } from "@autter/runtime-browser";
import { withFilters } from "@autter/runtime-browser/filters";

initAutterBrowser(withFilters({
  endpoint: "/api/autter-runtime",
  service: "web-app",
  ignoreErrors: ["ResizeObserver loop", /^ChunkLoadError/],
  denyUrls: [/^(chrome|moz|safari-web)-extension:/, "googletagmanager.com"],
  // sampleRate: 0.25,  // only if the user asks; fatal errors are never sampled out
}));
```

`/filters` is opt-in like `/breadcrumbs` (about 0.35 KB); an existing
`beforeSend` still runs, after the filters. `@autter/runtime-next/client`
re-exports `withFilters`.

## The signed-in user, and an ID they can quote

Call `setUser(id)` once the app knows who is signed in, and `setUser(null)` on
sign-out. Use the opaque id the support tool knows the customer by, the same
one the backend records as `enduser.id`; never an email or a name. Autter uses
it to link support tickets and "it didn't work" reports to that customer's
browser errors.

When a request to the app's API fails, the error UI can show the user the
`x-request-id` from the failed response as `Request ID: <id>`, so a ticket
that quotes it matches the server request and its errors. That changes what
users see: propose it and add it with the user's go-ahead.

## API surface

```ts
initAutterBrowser({ endpoint, clientKey?, service, environment?, release?, sessionTracking?, captureActions?, captureNetworkFailures?, captureTimings?, beforeSend? });
captureException(error, context?);       // report a caught error; reads code/why/fix/link/expected; context.fingerprint overrides grouping (1.6.0)
await autterErrorFromResponse(response); // 1.4.0+: JSON error body → Error with code/why/fix/requestId
captureMessage(message, severity?, context?); // warning/info without an exception — severity "fatal"|"error"|"warning"|"info", default "warning"
trackEvent(name, props?);                 // coarse usage counter — no PII in props
setUser(id | null);                       // opaque id ONLY — never an email/name; the same id the server records as enduser.id
setContext(context | null);               // merged into every subsequent event
flush();                                   // force-send the queue now (rarely needed — auto-flushes)

// @autter/runtime-browser/breadcrumbs (1.6.0)
enableBreadcrumbs(options?);               // options: { console?: boolean }
addBreadcrumb({ type?, message, level?, data? });
clearBreadcrumbs();

// @autter/runtime-browser/filters (1.7.0)
withFilters({ ...initOptions, sampleRate?, ignoreErrors?, denyUrls? }); // returns init options with a beforeSend
createFilter(filters, next?);              // the bare beforeSend hook

// @autter/runtime-browser/tracing (1.6.0)
enableTracePropagation({ tracePropagationTargets? });
disableTracePropagation();
```

Warnings share the errors table server-side (a `severity` column), so
`captureMessage` calls group and aggregate exactly like errors. While
instrumenting, add it to warning-worthy paths: recoverable failures,
degraded API responses, deprecated feature usage. Keep messages as stable
templates (numbers are normalised out server-side) and PII-free.

`props`/`context` values must be primitives or small objects — never pass
emails, form fields, cookies, or request/response bodies through
`setUser`/`setContext`/`trackEvent`; the package masks obvious sensitive keys
and email strings, but that is defense in depth rather than permission to
send personal data.

## Selftest in an isolated environment

Add a temporary development-only call after init to exercise both event
families and force the send. Remove it after verification; package imports
are not automatically available as globals in DevTools. In Next.js, import
these functions from `@autter/runtime-next/client` instead:

```ts
import { captureMessage, trackEvent, flush } from "@autter/runtime-browser";
captureMessage("autter selftest", "info"); // error/warning pipeline
trackEvent("autter_selftest");             // usage-metrics pipeline
flush();                                   // skip the batch window
```

For relay modes, a temporary handled exception can additionally prove the
error route. On 1.4.0+, give it a code to prove code grouping:

```ts
import { captureException, flush } from "@autter/runtime-browser";
captureException(Object.assign(new Error("autter selftest"), { code: "autter_selftest.browser" }));
flush();
```

For a built app, run this exception from a **production build** served
locally or in a preview environment, with `environment` set to a
non-production value, so its stack proves source maps. With breadcrumbs
enabled, click a labeled control and make one failing request first. With
trace propagation and a Node backend, call the backend's temporary
`/__autter-selftest/error` route (see `otel-node-style`) so the browser
records a `request_failure` with a trace id.

## Verify

1. Load the app, open the devtools network tab, run the selftest above.
2. Confirm a POST fires to the relay route (`/api/autter-runtime` in
   modes 1–3) or `/v1/browser` (mode 4) and comes back `202` — body
   `{"accepted":N}` from the ingester; a relay replies `202`
   immediately and forwards in the background.
3. The selftest proves init + transport, not the automatic hooks. In an
   isolated test environment, click a labeled test control and trigger a
   handled error; confirm the resulting occurrence has `autter.action` and
   an age of at most 30 seconds. Inspect the outbound payload to confirm it
   contains no DOM text, field values, query strings, or full URLs.
4. In that same isolated environment, use an intentional CSP block or an
   existing violation and confirm a `csp_violation` event is accepted and
   appears as a `CspViolation` issue. Do not create a production violation.
   If the console shows a block but no POST, check SDK init and `connect-src`.
5. Direct-key mode only: a `403` here means the current origin isn't on
   the key's allow-list — check it was registered with the exact origin
   (scheme + host + port) the app is running on.
6. Ground truth in the dashboard (~1–2 min): one info-severity
   "autter selftest" issue and a usage counter `event:autter_selftest` —
   both clearly named; the user can resolve or ignore them. On 1.4.0+, the
   coded selftest error shows the `autter_selftest.browser` code chip.
7. Request ids (1.4.0+, isolated environment): trigger a failing API call to a
   backend with request summaries and confirm the browser occurrence carries
   the same request id as the server summary (**Find request** in Runtime).
   For a cross-origin API, a missing id means the expose header is missing.
8. Source maps (built apps): `autter-runtime sourcemaps verify` passes on
   the production build (debug ids in every bundle, no `.map` files left,
   maps on the ingester); a local build without a key follows step 4 of the
   reference, and CI verifies the upload. The selftest
   exception's payload carries `debugIds`, and its issue shows original file
   paths and function names instead of minified chunk names. See step 4 of
   the [source maps reference](references/source-maps.md).
9. Breadcrumbs (when enabled): the exception event in the POST body has a
   `breadcrumbs` array, and the issue page lists "Steps before the error"
   with the labeled click and the failing request, oldest first. Request
   paths carry no query strings, and no message carries field values.
10. Trace links (when enabled): the failing request has a `traceparent`
   header `00-<32 hex>-<16 hex>-00`; the `request_failure` event carries
   that `traceId`; the browser issue links to the server trace, and the
   server error has its own stack. A cross-origin API request that fails its
   preflight means its CORS does not allow `traceparent` yet.
11. Remove the temporary selftest calls and routes.
