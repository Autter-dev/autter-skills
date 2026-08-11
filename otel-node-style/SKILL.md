---
name: otel-node-style
version: 1.0.0
description: How to wire Autter Runtime into Node.js backends (Express, Fastify, Koa, NestJS, plain http) and Next.js using the official @autter/runtime-node and @autter/runtime-next packages.
tags: [autter, telemetry, nodejs, nextjs, express, opentelemetry]
author: autter
---

# Node.js / Next.js style

Autter ships first-party npm packages for Node — use them instead of hand-
rolling raw OTel SDK setup.

## Plain Node (Express, Fastify, Koa, NestJS, http)

```bash
npm install @autter/runtime-node
```

Create an instrumentation entry that loads **before** the app:

```js
// instrument.cjs
const { initAutterServer } = require("@autter/runtime-node");

initAutterServer({
  apiKey: process.env.AUTTER_RUNTIME_KEY,
  service: "<pick a name — e.g. the package/app name>",
  release: process.env.GIT_SHA, // optional
});
```

Start the app with `node --require ./instrument.cjs server.js` (or the
equivalent `-r` flag / `NODE_OPTIONS="--require ./instrument.cjs"` for your
process manager). This must load first so HTTP auto-instrumentation
patches `http`/`https` before your framework requires them.

**ESM-only apps** (`"type": "module"` with no CJS entry) need OTel's loader
hook instead of `--require`:

```bash
node --import ./instrument.mjs server.js
```

```js
// instrument.mjs
import { initAutterServer } from "@autter/runtime-node";
initAutterServer({ apiKey: process.env.AUTTER_RUNTIME_KEY, service: "..." });
```

`initAutterServer` auto-instruments incoming/outgoing HTTP (works for
Express, Fastify, Koa, NestJS out of the box since they all sit on Node's
`http` module). Add framework-specific instrumentations via the
`instrumentations` option only if the user asks for deeper spans (e.g.
`@opentelemetry/instrumentation-express` for route-name attribution) — not
required for errors/usage to work.

### Capturing handled exceptions

Wrap risky code (or a global error-handling middleware) with:

```js
const { captureException } = require("@autter/runtime-node");

app.use((err, req, res, next) => {
  captureException(err, { route: req.path });
  next(err);
});
```

Uncaught exceptions and unhandled rejections that crash the process are
captured automatically via `process.on("uncaughtExceptionMonitor", ...)` —
no extra code needed, this is wired inside `initAutterServer`.

### Capturing warnings (not just errors)

Autter stores warnings/info in the same table as errors with a `severity`
column, so they group and aggregate identically. When you see meaningful
warning-worthy moments in the code — deprecated code paths, degraded
dependencies, recoverable failures, suspicious slowness — wire them up
with `captureMessage`:

```js
const { captureMessage } = require("@autter/runtime-node");

captureMessage("Legacy /orders lookup used", "warning", { client: req.get("x-client-id") });
// severity: "fatal" | "error" | "warning" | "info" (default "warning")
```

Good places to add these while instrumenting: existing `console.warn` /
`logger.warn` call sites with real diagnostic value (add `captureMessage`
alongside them — don't remove the log), deprecation branches, retry/
fallback paths, and catch blocks that swallow errors. Prefer stable
message templates ("cache degraded to 40%" is fine — numbers are
normalised out server-side) and never put PII in the message or
attributes.

### Instrumenting slow processes (jobs, consumers, crons)

Autter's dashboard includes a **slow-process monitor**: it flags any
process that is both slow and repeating a lot, runs an automated
optimization analysis on the slowest traces, and can open a fix PR. HTTP
routes are covered automatically (request metrics are unsampled). Non-HTTP
work is only visible where a span exists — and regular traces are 1%
head-sampled — so wrap named units of work in `withProcessSpan`, which is
**always recorded**:

```js
const { withProcessSpan } = require("@autter/runtime-node");

// queue consumer, cron tick, batch job, DB-heavy call…
await withProcessSpan("invoice.rebuild", async () => {
  await rebuildInvoices();
});
```

Errors thrown inside are rethrown (and mark the span failed). Nested HTTP/
DB calls become children of the span, so a slow run shows where the time
went. Use stable, low-cardinality names (`"email.digest"`, not
`"email.digest:user-123"` — put ids in attributes). Instrument the repo's
background jobs, queue consumers, and scheduled tasks this way while
wiring the service; ask before instrumenting more than the obvious ones.

### Graceful shutdown

```js
const server = initAutterServer({ ... });
process.on("SIGTERM", async () => {
  await server.shutdown();
  process.exit(0);
});
```

### Relaying browser telemetry through this backend

If this backend serves a frontend (or a frontend calls it same-origin),
add one relay route so the browser never sees the server key:

```js
const { createBrowserRelayHandler } = require("@autter/runtime-node");

app.post(
  "/api/autter-runtime",
  createBrowserRelayHandler({ apiKey: process.env.AUTTER_RUNTIME_KEY }),
);
```

Works with or without a body-parser middleware in front of it. Ships a
built-in per-IP rate limit (120 req/min default; pass
`perIpRateLimit: false` only if a WAF/CDN already rate-limits this route).
Then point the browser tracker at it — see `otel-browser-style`, "with a
relay" section.

## Next.js (any router)

```bash
npm install @autter/runtime-next
```

Three files:

**1. `instrumentation.ts`** (server tracing — runs once, server-side only):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerAutter } = await import("@autter/runtime-next");
    registerAutter({
      apiKey: process.env.AUTTER_RUNTIME_KEY!,
      service: "<app name>",
      release: process.env.GIT_SHA,
    });
  }
}
```

Next.js only calls `register()` when `instrumentationHook` is enabled
(default on in recent Next.js — check `next.config.js` if it's an older
version and add `experimental: { instrumentationHook: true }` if missing).

**2. `app/api/autter-runtime/route.ts`** (browser relay — App Router):

```ts
import { createAutterRelayRoute } from "@autter/runtime-next";

export const { POST } = createAutterRelayRoute({
  apiKey: process.env.AUTTER_RUNTIME_KEY!,
});
```

Pages Router: use `@autter/runtime-node`'s `createBrowserRelayFetchHandler`
directly inside an API route handler, adapting to the Pages Router request
object, or add an App Router route alongside if the app is hybrid.

**3. A client component** (browser tracker + error boundary):

```tsx
"use client";
import { initAutterBrowser, AutterErrorBoundary } from "@autter/runtime-next";

initAutterBrowser({ endpoint: "/api/autter-runtime", service: "<app name>" });

export function Providers({ children }: { children: React.ReactNode }) {
  return <AutterErrorBoundary>{children}</AutterErrorBoundary>;
}
```

Mount `<AutterErrorBoundary>` near the root layout so it catches render
errors app-wide — `window.onerror` does **not** fire for React render
errors, so skipping this boundary silently misses them.

## Defaults you should know (don't change without asking)

- Trace sampling: 1% of successful traces (`traceSampleRate`, default
  `0.01`). Captured exceptions bypass sampling entirely — always sent.
  Raising this on a high-traffic service multiplies telemetry volume/cost;
  only change it if the user explicitly asks.
- Metrics export every 60s (`metricIntervalMs`).
- `environment` defaults to `NODE_ENV` (falls back to `"production"`).
  Set it explicitly if the user has a non-standard env var for this.
- Default ingester endpoint is `https://otlp.autter.dev` — only override
  `endpoint` if the user is self-hosting the OSS ingester.

## Verify

1. Start the app with the instrumentation loaded.
2. Hit any HTTP route once — a 200 from `/v1/traces`/`/v1/metrics` at the
   next flush interval (up to 60s) confirms auth worked.
3. Call `captureException(new Error("test"))` once and confirm no error is
   thrown/logged from the SDK itself (it forwards async and never throws
   into your app).
4. If using the relay, POST any tiny test payload to the relay route and
   confirm it returns `202` immediately — the relay always responds fast
   and forwards in the background.
