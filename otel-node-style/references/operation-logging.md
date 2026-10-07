# Operation logging setup

Read this when configuring Node/Next.js diagnostics or updating an existing
Runtime install. Operations and logs require Node/Next.js SDK **1.4.0 or later**.
Request summaries, `runtimeContext`, inline messages, the carrier and the AI
rollup require SDK **1.5.0 or later** and, for request columns and code
grouping, a **1.5.0+** ingester. The source package version alone does not
establish installed or deployed support.

## Check capability before changing application code

- Inspect the installed exports for `withRuntimeOperation`, `runtimeLogger`,
  `createRuntimeLogger`, `flushRuntimeLogs`, and `runtimeLogStats`; for 1.5.0
  features also `runtimeContext`, `autterRequests`, `withRuntimeRequest` and
  `runInBackground`. For Next.js, inspect `@autter/runtime-next/server` and its
  resolved Node dependency.
- Upgrade to a published **1.4.0+** release using the project's package manager
  and update its lockfile. Do not treat an existing `^1.3.x` range as evidence.
  If the required release cannot be installed, complete basic
  Runtime setup and report operation logging as pending.
- Check the deployed **1.4.0+** ingester accepts authenticated `/v1/logs`; self-hosted
  instances need migration `0011-runtime-logs`. An empty preflight proves route
  authentication, not storage. Check stored records separately.
- The platform backend, fix worker, and frontend also need operation-evidence
  support. Roll out ingester first, SDK release next, platform consumers last.

## Initialize once and preserve existing logging

Add options to the existing `initAutterServer` or Next.js `registerAutter` call:

```ts
logging: { console: false, minLevel: "info" }
```

Use `console: false` when the application's existing logger already writes
stdout. The default is `true`; export works in either mode. `minLevel` accepts
`debug`, `info`, `warning`, or `error`; the method is named `warn`. It filters
ordinary messages, not completed operation summaries. Do not replace Pino,
Winston, console interception, or an existing OTel provider as a side effect.
Add selected diagnostic calls explicitly; no automatic Pino/Winston adapter is
provided. If another OTel SDK already owns the process, resolve provider
ownership before installing Runtime, rather than registering a second SDK.

Node instrumentation must load before the app. Next.js initializes in
`instrumentation.ts` under `NEXT_RUNTIME === "nodejs"`; import logging APIs
from `@autter/runtime-next/server`. Never import them into a client component
or edge handler. A browser relay running at the edge does not make these Node
APIs available there; edge code uses `@autter/runtime-next/edge` (see
`otel-edge-style`).

## Instrument meaningful customer operations

Use stable names such as `checkout` or `invoice.rebuild`, with opaque IDs in
context. Reuse an existing `withProcessSpan` boundary by converting it to
`withRuntimeOperation` where steps/outcomes help; avoid two wrappers for the
same unit of work. Keep database/dependency child instrumentation and LLM
wrappers so the operation trace explains the underlying calls.

```ts
import { withRuntimeOperation, runtimeLogger } from "@autter/runtime-node";

type CheckoutServices = {
  reserveInventory(): Promise<void>;
  confirmPayment(): Promise<{ confirmed: boolean; attempts: number }>;
  createOrder(): Promise<void>;
};

export async function checkout(services: CheckoutServices) {
  return withRuntimeOperation("checkout", async (operation) => {
    operation.setContext({ cart: { item_count: 3 }, payment: { provider: "stripe" } });
    await operation.step("reserve_inventory", () => services.reserveInventory());
    const payment = await operation.step("confirm_payment", () => services.confirmPayment());
    runtimeLogger.info("Payment confirmation returned", { payment: { attempts: payment.attempts } });
    if (!payment.confirmed) {
      operation.outcome("failed", "Payment was not confirmed; no order created");
      return { created: false };
    }
    await operation.step("create_order", () => services.createOrder());
    return { created: true };
  });
}
```

- A returned callback defaults to `succeeded`. Declare `failed`, `degraded`,
  `cancelled`, or `pending` when that better describes the business result.
  `pending` does not confirm a queued downstream task completed.
- A step records elapsed time and whether its callback threw, not whether a
  returned payment result was accepted. A recovered step failure does not
  automatically fail the overall operation. Await all steps before returning.
- A thrown operation error is recorded by its process span and rethrown
  unchanged. Avoid capturing it again at the same boundary. An explicit failed
  outcome emits `autter.outcome` with the reporting callsite; that is evidence
  of where the failure was reported, not proof of the causal line.
- `runtimeLogger.error(error, context)` is a diagnostic log. Use
  `captureException` for a handled exception that needs issue grouping, or a
  failed operation outcome for a business failure. Keep `captureMessage` only
  for intentional issue-producing messages; ordinary info/warnings use the
  logger. Do not manufacture exceptions from every log line.
- Nested context deep-merges objects and replaces arrays. Logs inherit context,
  operation/parent IDs and active trace/span IDs. Reserved IDs are SDK-owned.
  Context isolation is process-local. On 1.4.x, pass an opaque workflow ID
  through a queue explicitly; it creates no parent link. On 1.5.0+, use the
  carrier below, which does.

## Requests, inline messages and context (1.5.0+)

A request middleware (`autterRequests`, `autterFastify`, `withRuntimeRequest`)
opens an operation with `autter.operation.kind=request` around each request.
Explicit `withRuntimeOperation` calls inside it become children automatically.
Existing operations keep `kind=operation`.

| Field | Meaning |
| --- | --- |
| name | `METHOD /route/template` (fetch wrappers: `name` option or normalised path) |
| `autter.request.id` | Honoured `x-request-id` (`^[\w.-]{8,128}$`) or a new UUID; echoed as a response header |
| `http.request.method`, `http.route`, `http.response.status_code` | Request facts |
| `autter.request.aborted` | Client closed before the response finished |
| outcome | Explicit `outcome()` wins; else thrown error or status ≥ 500 → `failed`, aborted → `cancelled`, `expected` coded error → `degraded`, otherwise `succeeded` |

`runtimeContext` reaches the current request or operation from anywhere in its
async call tree, so helpers no longer need the `operation` handle:

```ts
import { runtimeContext } from "@autter/runtime-node";

runtimeContext.set({ cart: { items: 3 } });          // deep-merged context
runtimeContext.info("Applied coupon", { coupon: "SPRING" });
runtimeContext.outcome("degraded", "Used cached prices");
const supportRef = runtimeContext.requestId;          // for emails and support tickets
```

- `debug`/`info` messages are folded into the summary as
  `autter.operation.logs` (`{ t, level, message, attrs? }`, `t` in ms since
  start), max 50 messages of up to 300 characters (~6 KB per timeline), then
  `autter.operation.logs_truncated=true`. `logging.minLevel` still applies. `warn`/`error`
  are folded **and** emitted as separate records. `autter.operation.level` is
  the highest level seen. `logging.inline: false` turns folding off.
- Outside any request or operation, `set` and `outcome` are no-ops and the
  log methods behave like `runtimeLogger` (separate records). `runtimeContext.error(err)`
  also attaches the error's code/why/fix to the summary when there is one.
- Summaries are **always kept**: no sampling. The only volume controls are
  the middleware's `ignore` globs (health and metrics routes only), field
  budgets and the ingester's `LOG_TTL_DAYS`.

### Work beyond the request

```ts
await runtimeContext.fork("pdf.render", () => renderPdf(order));   // awaited child
runInBackground("cache.warm", () => warmCache(order.id));          // not awaited; errors captured

await queue.add("receipt", { orderId: order.id, autter: runtimeContext.carrier() });
// consumer
await withRuntimeOperation("receipt.send", (op) => sendReceipt(job.data.orderId),
  { order: { id: job.data.orderId } }, { from: job.data.autter });
```

- `fork` and `runInBackground` capture the parent id at call time, so they
  still link after the request summary is sealed (a plain nested
  `withRuntimeOperation` keeps 1.4.0 behaviour: no link once the parent
  finished). `runInBackground` errors are recorded on the child, never as
  unhandled rejections.
- The carrier is `{ v: 1, op, req?, traceparent? }`: ids only, safe to
  serialise into a job payload (~200 bytes). The consumer gets
  `autter.operation.parent_id`, the same request id, `autter.parent_trace_id`
  and a span in a new trace with a link to the producer. Malformed carriers are
  ignored.
- `waitUntil` (4th argument / `withRuntimeRequest` option) hands the flush to a
  serverless runtime. Next.js wires `after()` automatically.

### AI rollup

`instrumentLlmClient`, `withLlmCall` and `trackLlmCall` add to the current
summary's `autter.operation.ai = { calls, input_tokens, output_tokens,
cache_read_tokens, cost_usd, models }`. No extra code is needed beyond the
existing LLM wiring; the per-call LLM rows are unchanged.

## Delivery, privacy, and shutdown

Never include bodies, payment details, personal data, prompts, or secrets.
Redaction runs before stdout/export and again at ingestion, but cannot identify
every secret. Bounded context may be truncated: 512 nodes, depth 6, 16 KB per
string. At most 64 steps and 50 inline messages are retained per summary.
Records expire after the ingester's `LOG_TTL_DAYS` (default 14).

The buffer holds up to 1,000 records or 4 MiB. Each flush has a 10-second budget
and at most three attempts per batch; failed batches remain for later flushes.
`runtimeLogStats()` exposes buffered/dropped counts. Delivery is best effort.

Await `flushRuntimeLogs()` in a short-lived job/serverless invocation before
its execution window closes. It flushes logs only and rejects on failure;
also use the existing lifecycle flush for traces/metrics. Handle exporter
failure without silently replacing the application's result. In long-running
services, preserve the application's drain/exit behavior and await the existing
Runtime handle's `shutdown()` after work drains. It attempts logs before
closing tracing; report failure and undelivered records. Do not shut down a
shared SDK after every request or call `process.exit()` before awaiting delivery.

## Verify stored evidence

Use the style skill's temporary selftest only in an isolated test environment.
Keep HTTP metrics and LLM verification. Additionally:

1. Emit a structured message and two operations of the same stable name,
   service/environment/release: one declared failed result and one success.
   On 1.5.0+, run them inside a request so you also get a request summary.
   Use deterministic stubs, not payments, customer jobs, or real model calls.
2. Await log flushing; record the returned operation IDs without credentials.
3. Confirm **Runtime → Logs** contains the message and both summaries, with
   nested context, steps, outcome and trace IDs. On 1.5.0+, also confirm the
   request summary (Requests tab), its request id matching the response header,
   inline messages and the child operations linked to it. In self-hosting, inspect scoped
   `runtime_logs` rows. A `200` or a console line alone is insufficient.
4. Confirm the failed outcome produced an issue via traces and that its
   **Operation evidence** panel links the captured operation ID. Logs alone do
   not prove exception/issue capture. A successful comparison must match the
   operation, service, environment and release.
5. Report missing sources as unavailable, and a working source with no matching
   records as empty. Logs and traces arrive independently: refresh evidence or
   rerun analysis when later logs arrive. Stored evidence does not prove an RCA
   conclusion or a working fix. Existing fix eligibility and verification gates
   still apply; no new automatic merge/deploy behavior.
6. Remove the selftest and temporary debug/sampling overrides before commit.

For production, inspect existing traffic and exporter diagnostics instead.
Reference: [Runtime operation logging contract](https://github.com/Autter-dev/autter-runtime/blob/main/docs/OPERATION-LOGGING.md).
