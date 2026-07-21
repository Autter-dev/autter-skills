---
name: autter-runtime-setup
version: 1.0.0
description: Install Autter Runtime (open-source error + usage telemetry) into a codebase, regardless of language or framework. Run this first — it inventories the repo and routes to the right style skill for each service.
tags: [autter, telemetry, observability, opentelemetry, otlp, setup, onboarding]
author: autter
---

# Autter Runtime Setup

You are installing **Autter Runtime** — open-source error tracking and usage
telemetry (github.com/Autter-dev/autter-runtime) — into the user's repository.
Autter Runtime is deliberately just two credentials and three HTTP endpoints;
everything else is language-specific sugar. That means you can wire it into
**any** stack by following the right style guide below, even ones without a
dedicated Autter package.

## Step 0: Get an ingest key

Autter Runtime needs one ingest key per repository to authenticate telemetry.

Ask the user: **"Do you already have an Autter ingest key for this
repository?"**

- If yes: ask them to paste it (or the env var name it's already stored
  under). Keys look like `autter_rt_…` (server, secret) or `autter_rtc_…`
  (client, publishable).
- If no: tell them —

  > Create one on your Autter dashboard: **Settings → Access Tokens →
  > Runtime ingest keys → Create key**. Pick the repository this codebase
  > maps to, choose **Server** (for backends — keep it in env vars, never
  > commit it) or **Client** (for browser-only apps with no backend — it's
  > publishable but restricted to origins you list). Come back with the key
  > (or just the env var name if they'd rather set the env var themselves).

Never inline a server key (`autter_rt_…`) into source code — always an env
var (`AUTTER_RUNTIME_KEY` by convention). A client key (`autter_rtc_…`) is
publishable and safe to reference directly in frontend code, but still
prefer an env var / build-time constant so it's easy to rotate.

If the user wants to keep going before they have a key, proceed with the
setup and leave `AUTTER_RUNTIME_KEY` unset in `.env.example` — telemetry
simply won't send until it's filled in.

## Step 1: Inventory the repo

List every deployable unit you find — backend services, frontend apps,
workers, mobile apps, edge/serverless functions. For a monorepo, check each
workspace/package separately. Show the user the list before proceeding,
e.g.:

> Found: `apps/api` (Node/Express), `apps/web` (Next.js), `worker/`
> (Python/Celery). I'll wire up all three — let me know if you want to skip
> any.

## Step 2: Detect stack and load the matching style skill

For each service, detect its language/framework and consult the matching
style skill **before editing anything**:

| Detected stack | Style skill |
| --- | --- |
| Node.js: Express, Fastify, Koa, NestJS, plain `http` | `otel-node-style` |
| Next.js (any router) | `otel-node-style` (has a dedicated Next.js section) |
| Browser: React/Vue/Svelte/Angular/vanilla SPA, static site | `otel-browser-style` |
| Python: FastAPI, Flask, Django, plain WSGI/ASGI | `otel-python-style` |
| Go or Rust (any framework) | `otel-go-rust-style` |
| Anything else (Java, .NET, PHP, Ruby, Elixir, …) | `otel-generic-style` |

Each style skill tells you exactly what to install and what code to write
for that stack. Don't improvise instrumentation from general OTel knowledge
when a style skill exists for the stack — it encodes Autter-specific
defaults (sampling, error capture, the relay pattern) that generic
knowledge won't have.

## Step 3: Prefer the relay pattern when a service has both a frontend and a backend

If a service pair shares an origin (a backend serving or fronting its own
frontend), route browser telemetry through a same-origin relay on the
backend rather than shipping a client key to the browser:

- **Relay** (recommended default): the browser posts to a route on the
  user's own backend (e.g. `/api/autter-runtime`); that route attaches the
  **server** key and forwards to Autter server-side. No key ever reaches the
  browser bundle, no CORS/CSP surface, works behind ad-blockers that block
  third-party requests.
- **Direct client key**: only when there's no backend to relay through
  (static sites, JAMstack, browser extensions). Requires a **client** key
  scoped to specific origins.

The Node/Next.js style skill has the relay handler ready to use
(`createBrowserRelayHandler` / `createAutterRelayRoute`). For non-Node
backends, tell the user to add one small route that: validates the payload
shape, forwards it to `https://otlp.autter.dev/v1/browser` with
`Authorization: Bearer <server key>`, and returns 202 — or just point the
browser skill at a client key if standing up a relay isn't worth it for
their stack.

## Step 4: Verify

After wiring up each service:

1. Start it locally (or ask the user to).
2. Trigger one real error (a caught exception via `captureException`, or an
   actual thrown error) and, for server stacks, confirm a request went
   through (any instrumented route).
3. Check the response codes from the ingester directly if you have the key
   handy:
   - `GET https://otlp.autter.dev/healthz` → `200 {"ok":true,...}` confirms
     the ingester itself is reachable.
   - A successful `/v1/traces`, `/v1/metrics`, or `/v1/browser` call returns
     `200`/`202`. `401` means the key is missing/invalid; `403` on
     `/v1/browser` means the client key's origin allow-list rejected the
     request; `429` means the per-key or per-IP rate limit tripped.
4. Don't declare success until you've seen a non-error response for at
   least one real event per service.

## Step 5: Hand-off summary

Tell the user, concisely:

- Which services got server telemetry (OTel traces/metrics) vs. browser
  telemetry (errors/usage) vs. both.
- Whether browser events go through a relay or direct client key, and why.
- What env var(s) they still need to fill in (if the key wasn't available
  yet).
- That errors show up as issues in the Autter dashboard once real traffic
  hits an instrumented path — usage metrics follow ~60s later.

## Hard rules

- Never commit a server key (`autter_rt_…`) to source, `.env` files that get
  committed, or logs. Always an env var referenced by name.
- Never touch files outside the project the user is working in.
- Don't remove or disable existing observability/APM tooling (Sentry,
  Datadog, New Relic, etc.) unless the user asks you to — Autter Runtime is
  additive and coexists fine (it's just another OTel exporter / another
  error listener).
- Don't push, deploy, or open a PR without the user's explicit go-ahead.
- Default trace sampling is 1% (errors are always captured at 100% — never
  sampled out). Don't raise the sample rate without the user asking; high
  sampling on a busy service generates real cost.
