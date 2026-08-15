# Autter Skills

AI agent skills that set up [Autter](https://autter.dev) for you — wire
[Autter Runtime](https://github.com/Autter-dev/autter-runtime) — open-source
error tracking and usage telemetry — into any codebase, regardless of
language or framework.

Drop these into Claude Code, Cursor, Codex, or any editor that supports the
[Agent Skills standard](https://agentskills.io) and start using them
immediately.

## How to use this

```bash
npx skills add Autter-dev/autter-skills --all
```

Then tell your agent what you want:

- **"use the skills to install Autter Runtime in this project."** — runs
  `autter-runtime-setup`, which inventories your repo and routes each
  service to the right style skill automatically — you don't need to pick
  one yourself.

Want just one skill? `npx skills add Autter-dev/autter-skills --skill otel-node-style`

## What's inside

| Skill | Covers |
| --- | --- |
| [`autter-runtime-setup`](./autter-runtime-setup/) | **Start here.** Inventories the repo, gets an ingest key set up, routes each service to the right style skill below, verifies telemetry actually arrives. |
| [`otel-node-style`](./otel-node-style/) | Node.js (Express, Fastify, Koa, NestJS) and Next.js, via `@autter/runtime-node` / `@autter/runtime-next`. |
| [`otel-browser-style`](./otel-browser-style/) | Browser apps — React, Vue, Svelte, Angular, vanilla SPA, static sites — via `@autter/runtime-browser`. |
| [`otel-python-style`](./otel-python-style/) | FastAPI, Flask, Django, plain WSGI/ASGI, via the standard OpenTelemetry Python SDK. |
| [`otel-go-rust-style`](./otel-go-rust-style/) | Go and Rust backends, via each language's official OTel SDK. |
| [`otel-generic-style`](./otel-generic-style/) | Everything else — Java, .NET, PHP, Ruby, Elixir, Kotlin, … — via standard OTLP/HTTP + OTel env vars. |

## Why this works for any language

Autter Runtime's ingester is just two credentials and three HTTP endpoints:

| Credential | Lives in | Can |
| --- | --- | --- |
| Server key `autter_rt_…` | backend env vars | send OTLP traces/metrics, relay browser events |
| Client key `autter_rtc_…` | frontend bundles (publishable) | send browser events only, origin-restricted |

| Endpoint | Format |
| --- | --- |
| `POST /v1/traces`, `POST /v1/metrics` | OTLP/HTTP — protobuf or JSON |
| `POST /v1/browser` | compact JSON (`@autter/runtime-browser` payload) |

Any language with an OpenTelemetry SDK can send server telemetry — that's
every mainstream language. Only Node.js and the browser get dedicated
first-party npm packages (`@autter/runtime-node`, `@autter/runtime-browser`,
`@autter/runtime-next`); everything else is a thin style guide over the
standard OTel SDK for that language, which `otel-generic-style` covers even
when no dedicated skill exists yet.

## Getting an ingest key

Create one on your Autter dashboard: **Settings → Access Tokens → Runtime
ingest keys → Create key**. Pick the repository, then choose:

- **Server** — secret, for backends and relays. Keep it in env vars, never
  commit it.
- **Client** — publishable, for browser-only apps with no backend. Scoped
  to the exact origins you register it for.

Set the key in your own environment (shell profile, gitignored `.env`, or
secret manager) as `AUTTER_RUNTIME_KEY` — **don't paste key values into
the agent chat**. The skills are written to only ever reference the env
var by name; the value never needs to reach the agent.

Full docs: [github.com/Autter-dev/autter-runtime](https://github.com/Autter-dev/autter-runtime).

## License

MIT
