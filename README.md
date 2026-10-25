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
  repository's shared memory for the area being changed (what breaks there,
  what worked and what did not), its wiki, accepted learnings, production
  lessons, and indexed architecture through the authenticated Autter MCP, and
  checks the change against production lessons before committing.
- **"use the skills to install Autter Runtime in this project."** — runs
  `autter-runtime-setup`, which inventories your repo and routes each
  service to the right style skill automatically — you don't need to pick
  one yourself.
- **"Why did that request fail?"** (while running the app locally) — runs
  `autter-runtime-logs`, which reads the local request/operation records.
- **"Audit our error handling for Autter Runtime and propose error codes."** —
  runs `autter-runtime-errors`, which reports coverage gaps and proposes a
  catalog, and edits only after you approve.

Want just one skill? `npx skills add Autter-dev/autter-skills --skill otel-node-style`

## What's inside

| Skill | Covers |
| --- | --- |
| [`autter-repo-context`](./autter-repo-context/) | Reads the signed-in user's memory pages, the repository's shared memory (a map, one page per area of the codebase, and a what-works ledger, rewritten nightly from the team's agent sessions, reviews, production, CI and scans) before editing an area, repository wiki Markdown, accepted process learnings and team rules, production lessons for the files being edited, indexed code/architecture/run commands, and Runtime issues, requests and evidence packs through Autter MCP. Checks the diff with `check_change` before committing and rates the lessons it used. Uses source commits and freshness metadata to ground coding work in how the user works, how the platform is built, and what already broke in production. |
| [`autter-runtime-setup`](./autter-runtime-setup/) | **Start here.** Inventories services, request entry points, queues and error classes, checks installed and deployed capabilities (through `get_runtime_setup` when Autter MCP is connected), configures the chosen ingestion path, routes built frontends to source-map upload and Next.js apps to server error capture, verifies stored traces/errors with readable stacks, breadcrumbs and trace links, metrics, logs/operations, request summaries, coded errors and LLM calls where configured, then records supported instrumentation conventions in the repo's existing agent-instruction files. Synthetic tests run only in isolation. |
| [`otel-node-style`](./otel-node-style/) | Node.js (Express, Fastify, Koa, NestJS) and Next.js, via `@autter/runtime-node` / `@autter/runtime-next`, including per-request summaries, error catalogs and coded errors, server error hooks that keep stacks, Next.js server errors through `onRequestError`, background work, local files, testing and logger-only mode. Has a short edge section; `otel-edge-style` has the full edge setup. |
| [`otel-edge-style`](./otel-edge-style/) | Cloudflare Workers, Vercel Edge and Next.js `middleware.ts`, Deno and Bun, via `@autter/runtime-edge`. |
| [`otel-browser-style`](./otel-browser-style/) | Browser apps — React, Vue, Svelte, Angular, vanilla SPA, static sites — via `@autter/runtime-browser`, including source-map upload in four steps (check, `autter-runtime sourcemaps setup`, an upload-only key stored straight into CI, `sourcemaps verify`), breadcrumbs, links from browser errors to server traces, coded API errors and request-id correlation, CSP violations and privacy-conscious recent action context. |
| [`otel-python-style`](./otel-python-style/) | Django, FastAPI, Flask, Celery workers, plain WSGI/ASGI, via the standard OpenTelemetry Python SDK plus Runtime's copied `autter_tracing.py`, which keeps every error under head sampling; coded errors and request summaries through OTel attributes. |
| [`otel-go-rust-style`](./otel-go-rust-style/) | Go and Rust backends, via each language's official OTel SDK. |
| [`otel-generic-style`](./otel-generic-style/) | Everything else — Java, .NET, PHP, Ruby, Elixir, Kotlin, … — via standard OTLP/HTTP + OTel env vars. |
| [`autter-runtime-logs`](./autter-runtime-logs/) | Local debugging: reads `.autter/runtime/*.jsonl` (or `autter logs --local`) to explain failed or slow requests, one request id, and recent coded errors. |
| [`autter-runtime-errors`](./autter-runtime-errors/) | Coverage audit: uncovered routes/jobs, plain throws on user-facing paths, swallowing catches, invalid codes, sensitive context keys. Proposes a catalog; applies only with approval. |

### Versions

| Skill | Version | Runtime it targets |
| --- | --- | --- |
| `autter-runtime-setup` | 1.10.0 | all of the below |
| `otel-node-style` | 1.6.0 | `@autter/runtime-node` / `@autter/runtime-next` 1.6.0+ (1.5.0 for request summaries and codes, 1.4.0 for operations only) |
| `otel-edge-style` | 1.1.0 | `@autter/runtime-edge` 1.0.0+ (1.3.0 for request counts), `@autter/runtime-next/edge` 1.5.0+ |
| `otel-browser-style` | 1.4.0 | `@autter/runtime-browser` 1.6.0+ (1.4.0 for coded errors and request ids) |
| `otel-python-style`, `otel-go-rust-style`, `otel-generic-style` | 1.4.0 | OTel SDKs + ingester 1.5.0+ |
| `autter-runtime-logs`, `autter-runtime-errors` | 1.0.0 | runtime-node/next 1.5.0+ |

Self-hosted ingesters need **1.5.0+** for request summaries and code grouping,
1.6.0/1.7.0 for source maps and upload keys, and 1.10.0 for edge request counts.

## Repository knowledge through MCP

Connect your agent to `https://api.autter.dev/mcp` with OAuth and select the
organization containing your repository. Repository knowledge reads require
`mcp:read`; they do not require a Runtime ingest key or an SDK install.
`check_change` also needs `mcp:llm`, and `rate_lesson` needs `mcp:write`.
`autter-repo-context` uses `whoami` to match the repository, `get_memory` for
the user's own notes and the pages other members shared, `get_repo_memory` and
`search_context` for the repository's shared memory of the area it is about to
change (`update_repo_memory_page`, which needs `mcp:write`, records what it
learned), `get_wiki` for stored
pages, `get_learnings` for accepted conventions, `get_file_context` and
`get_lessons` for the production lessons in reach of the files it edits,
`check_change` on the diff before committing, and `get_repo_index` for
implementation evidence. It checks stored freshness against the current
checkout and reports missing sources explicitly.

With the [Autter CLI](https://github.com/Autter-dev/autter-cli) installed,
`autter install` also puts repository memory into the session automatically in
Claude Code, Codex, Gemini CLI, Droid, GitHub Copilot, OpenCode, Amp and Pi (the
map at session start, the matching sections with each prompt, an area's page
when a file in it is read). The skill covers every other agent, and tells all of
them to read an area's page before changing code in it; `autter memory` prints
the same memory in a terminal.

The `get_wiki` tool requires a backend deployment that includes it. Refresh
the client's MCP tool list after that deployment. If it is unavailable, the
skill continues with exposed learnings/index tools and local source code.

## Why Runtime works for any language

Autter Runtime's ingester uses these key types and HTTP endpoints:

| Credential | Lives in | Can |
| --- | --- | --- |
| Server key `autter_rt_…` | backend env vars | send OTLP traces/metrics/logs, relay browser events |
| Client key `autter_rtc_…` | frontend bundles (publishable) | send browser events only, origin-restricted |
| Upload key `autter_rtu_…` | CI secrets | upload and check source maps only (ingester 1.7.0+) |

| Endpoint | Format |
| --- | --- |
| `POST /v1/traces`, `POST /v1/metrics` | OTLP/HTTP — protobuf or JSON |
| `POST /v1/logs` | OTLP/HTTP logs — protobuf or JSON; requires the operation-logging ingester release |
| `POST /v1/browser` | compact JSON (`@autter/runtime-browser` payload) |
| `POST /v1/profiles` | symbolized pprof (server key only) |
| `POST /v1/sourcemaps` | release-keyed source map JSON with an optional debug id (upload or server key) |
| `POST /v1/sourcemaps/check` | which maps are already stored, so uploads skip them (upload or server key, 1.6.0+) |
| `GET /v1/compat` | ingester version and supported features (public) |
| `POST /v1/platform-events` | ECS/Kubernetes OOM and restart JSON (server key only) |

Any language with an OpenTelemetry SDK can send server telemetry — that's
every mainstream language. Node.js, edge runtimes and the browser get dedicated
first-party npm packages (`@autter/runtime-node`, `@autter/runtime-next`,
`@autter/runtime-edge`, `@autter/runtime-browser`); everything else is a thin style guide over the
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

For source map uploads in CI, create an upload-only key in the repository's
**Settings → Runtime → Source map upload key**, or let the agent create one
through Autter MCP.

Set the key in your own environment (shell profile, gitignored `.env`, or
secret manager) as `AUTTER_RUNTIME_KEY` — **don't paste key values into
the agent chat**. The skills are written to only ever reference the env
var by name; the value never needs to reach the agent.

## Endpoint regressions

The setup skills cover request histograms, release identity, and trace comparison requirements. Node/Next.js examples use SDK 1.3.2 and opt into bounded slow-request retention. External OTel exporters need explicit-bucket delta histograms. Self-hosted ingesters require 1.3.1 or later.

Enabling detection in the platform does not update customer SDKs. Incident feedback lets a team mark a diagnosis as correct, incorrect, or expected. Fixes open as draft pull requests labelled Verified, Builds or Proposal only, and a person merges them, unless the repository turned on auto-merge for verified, non-breaking fixes (off by default). Production verification uses existing telemetry; selftests belong only in isolated test environments.

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
logger bridge. Browser capture keeps its own APIs and endpoint; edge runtimes
use `@autter/runtime-edge` (see `otel-edge-style`).

Read [Node operation setup](otel-node-style/references/operation-logging.md)
or [customer logging docs](https://docs.autter.dev/runtime/operation-logging).
Logs improve the evidence available to RCA and eligible draft fixes; they do
not prove a diagnosis or a working fix. Delivery is best effort.

## Request summaries

Runtime's **Requests & logs** view shows one summary per HTTP request and
per-route counts. It stays empty until the service mounts a request boundary,
so the setup skills add one by default for every Node, Next.js and edge HTTP
service: `autterRequests()` for Express, Connect and NestJS; `autterFastify`
for Fastify; `withRuntimeRequest()` for fetch-style and Next.js route
handlers; and `withAutter` for edge runtimes. Health, readiness and metrics
paths are ignored, because summaries are never sampled. This needs SDK
**1.5.0+** (`runtime-edge` 1.0.0+) and ingester **1.5.0+**, which the skills
check through the public `/v1/compat` endpoint. Existing error handlers and
response formats are left alone unless the user agrees to
`autterErrorResponse()`. See
[request summaries setup](otel-node-style/references/request-summaries.md).

## Readable stacks, breadcrumbs, trace links and server errors

Runtime 1.6.0 makes errors easier to diagnose, and the setup skills wire it
by default where it applies:

- **Source maps.** Every frontend that ships built JavaScript gets
  `@autter/runtime-cli` as a dev dependency: the Vite/Rollup or webpack
  plugin, `withAutterSourceMaps` for Next.js, or the `autter-runtime
  sourcemaps inject` / `upload` commands and the `upload-sourcemaps` GitHub
  Action for anything else. Maps stay hidden, carry debug ids, and upload
  from CI or build secrets, never from the browser bundle. Without them,
  browser stacks point at minified chunks that RCA and fix agents cannot
  use. The agent does it in four steps: check (`get_runtime_setup` over
  Autter MCP, or `/v1/compat`, and `npm view @autter/runtime-cli version`),
  `autter-runtime sourcemaps setup`, an upload-only key (`autter_rtu_…`)
  from `create_sourcemap_upload_key` piped straight into the CI secret (or
  one the user creates) and named by prefix only, then `autter-runtime sourcemaps verify` on a
  production build. With a CLI older than 1.2.0 they wire it by hand; until
  the CLI is published, they wire nothing and report source maps as pending
  its release.
- **Server errors.** `autterErrorHandler()` (Express/Connect),
  `autterFastifyErrors`, `autterKoa()` and `captureRequestError` record a
  thrown error with its stack instead of a stackless 500, without changing
  existing error handlers. Next.js apps get `onRequestError` from
  `@autter/runtime-next/instrumentation` and
  `serverExternalPackages: ["@autter/runtime-node"]`, so routes share the
  SDK that `registerAutter` starts. Unhandled promise rejections are
  recorded by default.
- **Breadcrumbs and trace links** (opt-in, offered with a recommendation):
  `enableBreadcrumbs()` attaches the last 30 steps before a browser error,
  scrubbed like the rest of the event. `enableTracePropagation()` links a
  browser error to the server trace of the same request; cross-origin APIs
  must allow the `traceparent` header in CORS.

This needs SDK **1.6.0** (`runtime-edge` 1.1.0, `runtime-cli` 1.2.0 for
`setup` and `verify`) and ingester **1.6.0** (1.7.0 for upload keys and
`verify`'s ingester check), checked through `/v1/compat` (`breadcrumbs`,
`source_map_debug_ids`, `fingerprint_override`,
`browser_trace_propagation`, `sourcemap_upload_keys`, `source_map_verify`). See
[source maps setup](otel-browser-style/references/source-maps.md) and
[server errors setup](otel-node-style/references/server-errors.md).

## Coded errors

Runtime 1.5.0 also adds **coded errors** (`RuntimeError`, `defineRuntimeErrors`)
that group into one issue per code across the SDK and connected providers.
Error responses carry the code and `requestId`, and the browser links its
failures to the server request through `x-request-id`.

The setup skills check installed exports before using these APIs. Required
versions: runtime-node/next **1.5.0+**, `@autter/runtime-edge` **1.0.0+**,
runtime-browser **1.4.0+**, and ingester **1.5.0+**. A `latest` tag or a
version string in source does not prove support. Roll out the ingester first,
then SDKs and application redeploys, then platform consumers. Python, Go, Rust
and other stacks send the same attributes (`autter.error.code/why/fix/link/expected`,
`autter.operation.kind=request`, `autter.request.id`) through their OTel SDKs.

Codes are namespaced, stable and never contain ids, PII or secrets.
Application-declared `why`/`fix` are shown as declared, and Autter's analysis
treats them as hypotheses. Business failures marked `expected` are counted but
never open incidents. See [error catalogs](otel-node-style/references/error-catalog.md)
and [operation logging](otel-node-style/references/operation-logging.md).

## License

MIT

## Connect existing provider logs

`autter-runtime-setup` also supports repository-scoped Sentry, PostHog, Grafana/Loki, Datadog and webhook sources. Ask the agent to connect the chosen source in repository Runtime settings and verify stored logs, RCA and eligible draft fixes. Connector-only setup does not require an application SDK or a Runtime ingest key. See [external-source guidance](autter-runtime-setup/references/external-sources.md).
