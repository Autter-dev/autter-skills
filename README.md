# Autter Skills

AI agent skills that connect your codebase to [Autter](https://autter.dev).
Give coding agents repository wiki, learnings, and architecture context through
MCP, or wire [Autter Runtime](https://github.com/Autter-dev/autter-runtime) —
open-source error tracking, diagnostic logs, usage telemetry, and LLM tracing — into any
codebase, regardless of language or framework.

Drop these into Claude Code, Cursor, Codex, or any editor that supports the
[Agent Skills standard](https://agentskills.io) and start using them
immediately.

## How to use this

```bash
npx skills add Autter-dev/autter-skills --all
```

Then tell your agent what you want:

- **"Use Autter's memory, wiki, and learnings to understand this repo before coding."** —
  runs `autter-repo-context`, which reads the signed-in user's memory, the
  repository's wiki, accepted learnings, and indexed architecture through the
  authenticated Autter MCP.
- **"use the skills to install Autter Runtime in this project."** — runs
  `autter-runtime-setup`, which inventories your repo and routes each
  service to the right style skill automatically — you don't need to pick
  one yourself.

Want just one skill? `npx skills add Autter-dev/autter-skills --skill otel-node-style`

## What's inside

| Skill | Covers |
| --- | --- |
| [`autter-repo-context`](./autter-repo-context/) | Reads the signed-in user's memory pages, repository wiki Markdown, accepted process learnings and team rules, and indexed code/architecture/run commands through Autter MCP. Uses source commits and freshness metadata to ground coding work in how the user works and how the platform is built. |
| [`autter-runtime-setup`](./autter-runtime-setup/) | **Start here.** Inventories services, checks installed and deployed capabilities, configures the chosen ingestion path, verifies stored traces/errors, metrics, logs/operations and LLM calls where configured, then records supported instrumentation conventions in the repo's existing agent-instruction files. Synthetic tests run only in isolation. |
| [`otel-node-style`](./otel-node-style/) | Node.js (Express, Fastify, Koa, NestJS) and Next.js, via `@autter/runtime-node` / `@autter/runtime-next`. |
| [`otel-browser-style`](./otel-browser-style/) | Browser apps — React, Vue, Svelte, Angular, vanilla SPA, static sites — via `@autter/runtime-browser`, including CSP violations and privacy-conscious recent action context. |
| [`otel-python-style`](./otel-python-style/) | FastAPI, Flask, Django, plain WSGI/ASGI, via the standard OpenTelemetry Python SDK. |
| [`otel-go-rust-style`](./otel-go-rust-style/) | Go and Rust backends, via each language's official OTel SDK. |
| [`otel-generic-style`](./otel-generic-style/) | Everything else — Java, .NET, PHP, Ruby, Elixir, Kotlin, … — via standard OTLP/HTTP + OTel env vars. |

## Repository knowledge through MCP

Connect your agent to `https://api.autter.dev/mcp` with OAuth and select the
organization containing your repository. Repository knowledge reads require
`mcp:read`; they do not require a Runtime ingest key or an SDK install.
`autter-repo-context` uses `whoami` to match the repository, `get_memory` for
every member's notes in the organization, `get_wiki` for stored pages, `get_learnings` for
accepted conventions, and `get_repo_index` for implementation evidence. It
checks stored freshness against the current checkout and reports missing
sources explicitly.

The `get_wiki` tool requires a backend deployment that includes it. Refresh
the client's MCP tool list after that deployment. If it is unavailable, the
skill continues with exposed learnings/index tools and local source code.

## Why Runtime works for any language

Autter Runtime's ingester uses two key types and these HTTP endpoints:

| Credential | Lives in | Can |
| --- | --- | --- |
| Server key `autter_rt_…` | backend env vars | send OTLP traces/metrics/logs, relay browser events |
| Client key `autter_rtc_…` | frontend bundles (publishable) | send browser events only, origin-restricted |

| Endpoint | Format |
| --- | --- |
| `POST /v1/traces`, `POST /v1/metrics` | OTLP/HTTP — protobuf or JSON |
| `POST /v1/logs` | OTLP/HTTP logs — protobuf or JSON; requires the operation-logging ingester release |
| `POST /v1/browser` | compact JSON (`@autter/runtime-browser` payload) |
| `POST /v1/profiles` | symbolized pprof (server key only) |
| `POST /v1/sourcemaps` | release-keyed source map JSON (server key only) |
| `POST /v1/platform-events` | ECS/Kubernetes OOM and restart JSON (server key only) |

Any language with an OpenTelemetry SDK can send server telemetry — that's
every mainstream language. Only Node.js and the browser get dedicated
first-party npm packages (`@autter/runtime-node`, `@autter/runtime-browser`,
`@autter/runtime-next`); everything else is a thin style guide over the
standard OTel SDK for that language, which `otel-generic-style` covers even
when no dedicated skill exists yet.

Memory pressure uses that same OTLP metric endpoint in every backend
language. The Node package exports process metrics automatically; other
stacks enable a process meter or add the portable RSS/heap gauges described
in [Runtime's memory contract](https://github.com/Autter-dev/autter-runtime/blob/main/docs/MEMORY-PRESSURE.md).
The feature also needs the 1.3.3+ ingester and Autter backend/frontend
deployment. Applications must be redeployed after instrumentation changes;
OOM/restart correlation requires an ECS/Kubernetes event forwarder.

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

## Endpoint regressions

The setup skills cover request histograms, release identity, and trace comparison requirements. Node/Next.js examples use SDK 1.3.2 and opt into bounded slow-request retention. External OTel exporters need explicit-bucket delta histograms. Self-hosted ingesters require 1.3.1 or later.

Enabling detection in the platform does not update customer SDKs. Incident feedback lets a team mark a diagnosis as correct, incorrect, or expected. Fixes remain draft pull requests for human review. Production verification uses existing telemetry; selftests belong only in isolated test environments.

Full docs: [github.com/Autter-dev/autter-runtime](https://github.com/Autter-dev/autter-runtime).

## Structured logs and customer operations

The setup skills check installed SDK exports and deployed ingestion before
using `runtimeLogger`, `createRuntimeLogger`, or `withRuntimeOperation`.
Operation logging requires Node/Next.js SDK and ingester **1.4.0+**; an existing
`latest` install or `1.3.x` range alone does not establish support. The ingester needs
`/v1/logs` and migration `0011-runtime-logs`; the platform backend, fix worker
and frontend need the corresponding evidence deployment. Release ingester
first, SDKs next, then platform consumers, and redeploy customer applications.

Node/Next.js setup adds stable operation names, nested context, measured steps
and explicit business outcomes to selected checkout/job paths. It preserves
existing loggers, separates diagnostics from issue capture, and checks flushing
and stored evidence. Other backend languages use their OTel logs exporter and
logger bridge. Browser/edge capture keeps its own APIs and endpoint.

Read [Node operation setup](otel-node-style/references/operation-logging.md)
or [customer logging docs](https://docs.autter.dev/runtime/operation-logging).
Logs improve the evidence available to RCA and eligible draft fixes; they do
not prove a diagnosis or a working fix. Delivery is best effort.

## License

MIT

## Connect existing provider logs

`autter-runtime-setup` also supports repository-scoped Sentry, PostHog, Grafana/Loki, Datadog and webhook sources. Ask the agent to connect the chosen source in repository Runtime settings and verify stored logs, RCA and eligible draft fixes. Connector-only setup does not require an application SDK or a Runtime ingest key. See [external-source guidance](autter-runtime-setup/references/external-sources.md).
