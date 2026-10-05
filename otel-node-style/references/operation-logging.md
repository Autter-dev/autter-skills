# Operation logging setup

Read this when configuring Node/Next.js diagnostics or updating an existing
Runtime install. These APIs require Node/Next.js SDK **1.4.0 or later**;
the source package version alone does not establish installed or deployed support.

## Check capability before changing application code

- Inspect the installed exports for `withRuntimeOperation`, `runtimeLogger`,
  `createRuntimeLogger`, `flushRuntimeLogs`, and `runtimeLogStats`. For Next.js,
  inspect `@autter/runtime-next/server` and its resolved Node dependency.
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
APIs available there.

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
  Context isolation is process-local: explicitly pass an opaque workflow ID
  through a queue and set it on the consumer; it does not create a cross-process
  parent operation or automatic evidence link.

## Delivery, privacy, and shutdown

Never include bodies, payment details, personal data, prompts, or secrets.
Redaction runs before stdout/export and again at ingestion, but cannot identify
every secret. Bounded context may be truncated. At most 64 steps are retained.

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
   Use deterministic stubs, not payments, customer jobs, or real model calls.
2. Await log flushing; record the returned operation IDs without credentials.
3. Confirm **Runtime → Logs** contains the message and both summaries, with
   nested context, steps, outcome and trace IDs. In self-hosting, inspect scoped
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
