# Error catalogs and codes

Read this before adding `RuntimeError`, `defineRuntimeErrors`, `toClientError`
or `autterErrorResponse`. These APIs require `@autter/runtime-node` /
`@autter/runtime-next` **1.5.0+** (`@autter/runtime-edge` **1.0.0+** at the
edge). Code-based grouping needs a **1.5.0+** ingester. Confirm the exports in
the installed package first (see the Node style skill's capability check); a
`latest` tag or a version string in source proves nothing.

A code turns many message variants of one failure into **one issue**, across
the SDK, log-promoted errors and connected Sentry/PostHog/Datadog/Loki sources.
The fingerprint is `service + code`. Route and message stay visible as facets.

## Code rules

Codes must match `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$`, max 80 characters.
The SDK drops an invalid code (one console warning) and the error groups by
message as before.

| Rule | Good | Bad |
| --- | --- | --- |
| Namespaced by domain | `billing.declined` | `declined` |
| Stable across releases | `auth.session_expired` | `auth.session_expired_v2` after a refactor |
| Low cardinality (one per failure *kind*) | `inventory.reservation_timeout` | `inventory.timeout_sku_123` |
| No ids, emails, tenants, user data | `github.app_permission_missing` | `github.missing_for_acme` |
| Lowercase, `_` inside segments, ≤ 4 segments | `billing.limit.monthly` | `Billing.Limit`, `billing-limit` |

The platform also caps distinct codes per service per day (500). Above it, new
codes fall back to message grouping. Treat hitting the cap as a bug.

Never invent a code for a third-party error you did not define (a Stripe or
AWS SDK error). Wrap it in your own coded error with the original as `cause`,
or leave it uncoded.

## Catalog layout

One catalog per domain, next to the code that throws it
(`src/billing/errors.ts`, `src/auth/errors.ts`). The namespace is the first
segment of every code in that file.

```ts
import { defineRuntimeErrors } from "@autter/runtime-node"; // Next.js: "@autter/runtime-next/server"

export const billingErrors = defineRuntimeErrors("billing", {
  declined: {
    status: 402, message: "Payment declined", expected: true,
    why: "The card issuer rejected the charge", fix: "Use another card",
    link: "https://docs.example.com/payments#declined",
  },
  limit: ({ plan }: { plan: string }) => ({
    status: 429, message: `Plan ${plan} limit reached`, fix: "Upgrade the plan",
  }),
});

throw billingErrors.declined();               // code "billing.declined"
throw billingErrors.limit({ plan: "free" });  // code "billing.limit"
```

One-off errors can use the class directly:

```ts
throw new RuntimeError({
  code: "inventory.reservation_timeout",
  message: "Could not reserve stock",
  why: "The inventory service did not answer in time",
  fix: "Retry in a minute",
  status: 503,
  cause: err,                 // chain kept as exception.cause.1..5
  internal: { sku },          // span only, redacted; never in logs or responses
});
```

- `message`, `why`, `fix` and `link` are **sent to clients** by
  `autterErrorResponse()` / `toClientError()`. Write them for the person who
  sees the error, and never put ids, PII, secrets or internal hostnames in
  them. Diagnostic detail goes in `internal` or `runtimeContext.set()`.
- `why`/`fix` are *declared* by the application. Autter's analysis treats them
  as hypotheses to confirm or contradict, not as the root cause.

## `expected` decision table

`expected: true` records the error (counted, visible, request summary becomes
`degraded`) but it never opens an incident or triggers a draft fix. Alerts fire
only on a rate change (over 3× the 7-day hourly baseline).

| Failure | `expected` |
| --- | --- |
| Card declined, insufficient funds, plan limit reached | `true` |
| Input validation, 404 for a user-supplied id, permission denied by policy | `true` |
| Session expired, CSRF token stale | `true` |
| Dependency timeout, 5xx from a vendor, DB connection error | `false` |
| Unhandled branch, null dereference, invariant violated | `false` |
| A "business" failure that should never happen (negative balance) | `false` |

If in doubt, leave it `false`. Marking a defect as expected hides it from RCA.

## Migrating existing `AppError` / `HttpError` classes

`captureException` duck-types `code`, `why`, `fix`, `link`, `status` and
`expected` on **any** error object, so existing classes keep working.

1. Keep the class, its name, its constructor and its **message text exactly**.
   Clients, tests and support docs may match on the message.
2. Add the fields. If the class already has a `code` that breaks the rules
   (`"ERR_PAYMENT"`, numeric codes), add a separate mapped property instead of
   renaming the public one, and map it in one place:

   ```ts
   class HttpError extends Error {
     constructor(public status: number, message: string,
                 public code?: string, public why?: string, public fix?: string,
                 public expected = status < 500) {
       super(message);
     }
   }
   // before: throw new HttpError(402, "Payment declined");
   throw new HttpError(402, "Payment declined", "billing.declined",
                       "The card issuer rejected the charge");
   ```

3. Codes become part of the API contract once clients see them. Ask before
   adding codes to a public API that has its own versioning rules.
4. Do not convert every `throw` at once. Start with user-facing failures and
   the top issues by volume, then let the `autter-runtime-errors` skill audit
   the rest.

## `autterErrorResponse` with existing error middleware

The client body is
`{ "error": { "message", "code"?, "why"?, "fix"?, "link"?, "requestId"? } }`.
`internal`, stacks and causes are never included.

- **No error handler yet (Express):** mount `app.use(autterErrorResponse())`
  after all routes.
- **Existing handler:** keep it, its status mapping and its response shape
  unless the user asks to change the shape. Use `toClientError` for the body
  only where the shape matches, otherwise add `requestId` to the existing body:

  ```ts
  app.use((err, req, res, next) => {
    captureException(err);   // keep exactly one capture per error
    const status = typeof err.status === "number" ? err.status : 500;
    res.status(status).json(toClientError(err, runtimeContext.requestId));
  });
  ```

- Check the installed JSDoc/types of `autterErrorResponse` to see whether it
  captures the exception. If it does, remove the duplicate capture at that
  boundary. Never capture the same error twice.
- 5xx bodies for uncoded errors must stay generic. Check what the installed
  `toClientError` returns for a plain `Error`; if it echoes the raw message,
  map uncoded 5xx errors to a generic message yourself. Never send a database
  driver's `err.message` to a client.
