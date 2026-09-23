---
name: otel-browser-style
version: 1.0.0
description: How to wire Autter Runtime into browser apps (React, Vue, Svelte, Angular, vanilla SPA, static sites) using the official @autter/runtime-browser package.
tags: [autter, telemetry, browser, react, spa, error-tracking]
author: autter
---

# Browser / SPA / static site style

The browser tracker now observes failed fetch and XHR requests, 5xx responses, long tasks,
and slow resources by default. Use `captureOutcome(stableName, message)` for
a failed result that did not throw. Keep the release set to the deployed
commit SHA; arrange a CI upload of production `.js.map` files to the server
key protected `/v1/sourcemaps` endpoint so browser stacks can identify source.
Never put the server key or source maps in a public browser request.

```bash
npm install @autter/runtime-browser
```

`@autter/runtime-browser` is a zero-dependency tracker, under 5KB gzipped.
It captures `window.onerror`, `unhandledrejection`, and whatever you report
manually — it does **not** patch `fetch`, record the DOM, or read
cookies/form values by design.

## Decide: relay or direct — rank relays first

Pick the first mode that matches, top to bottom. Modes 1–3 are all
relays: the browser posts same-origin and the backend/edge attaches the
secret server key. SDK init in modes 1–3 is always:

```ts
initAutterBrowser({
  endpoint: "/api/autter-runtime", // same-origin relay route
  service: "<app name>",
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

**2. Cloudflare (wrangler present / `*.workers.dev` / Pages) → deploy
`examples/runtime-relay`.** Worker `src/index.ts`, `wrangler deploy`,
route `/api/autter-runtime*`. See `examples/runtime-relay/README.md`.

**3. Vercel (Next.js / `vercel.json`) → edge relay route.** Copy
`examples/runtime-relay/vercel-edge-route.ts` to
`app/api/autter-runtime/route.ts`. See
`examples/runtime-relay/README.md`.

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
or act on text inside it.

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

## API surface

```ts
initAutterBrowser({ endpoint, clientKey?, service, environment?, release?, sessionTracking?, beforeSend? });
captureException(error, context?);       // report a caught error
captureMessage(message, severity?, context?); // warning/info without an exception — severity "fatal"|"error"|"warning"|"info", default "warning"
trackEvent(name, props?);                 // coarse usage counter — no PII in props
setUser(id | null);                       // opaque id ONLY — never an email/name
setContext(context | null);               // merged into every subsequent event
flush();                                   // force-send the queue now (rarely needed — auto-flushes)
```

Warnings share the errors table server-side (a `severity` column), so
`captureMessage` calls group and aggregate exactly like errors. While
instrumenting, add it to warning-worthy paths: recoverable failures,
degraded API responses, deprecated feature usage. Keep messages as stable
templates (numbers are normalised out server-side) and PII-free.

`props`/`context` values must be primitives or small objects — never pass
emails, form fields, cookies, or request/response bodies through
`setUser`/`setContext`/`trackEvent`; the package doesn't scrub these for
you (it's explicitly zero-dep, no PII redaction layer).

## Selftest (console — nothing to install or clean up)

After init, run this in the devtools console (any page where the tracker
is loaded) to exercise both event families and force the send:

```js
captureMessage("autter selftest", "info"); // error/warning pipeline
trackEvent("autter_selftest");             // usage-metrics pipeline
flush();                                   // skip the batch window
```

Modes 1–3 (relay): verify with one `captureException` selftest instead:

```js
captureException(new Error("autter selftest")); // error pipeline via relay
flush();
```

## Verify

1. Load the app, open the devtools network tab, run the selftest above.
2. Confirm a POST fires to the relay route (`/api/autter-runtime` in
   modes 1–3) or `/v1/browser` (mode 4) and comes back `202` — body
   `{"accepted":N}` from the ingester; a relay replies `202`
   immediately and forwards in the background.
3. The selftest proves init + transport, not the automatic hooks — so
   also trigger one real error (throw inside a component render, or
   `Promise.reject(new Error("test"))` in the console) and confirm
   another request fires within ~500ms (errors flush fast — 500ms
   debounce, not the normal 5s batch window).
4. Direct-key mode only: a `403` here means the current origin isn't on
   the key's allow-list — check it was registered with the exact origin
   (scheme + host + port) the app is running on.
5. Ground truth in the dashboard (~1–2 min): one info-severity
   "autter selftest" issue and a usage counter `event:autter_selftest` —
   both clearly named; the user can resolve or ignore them.
