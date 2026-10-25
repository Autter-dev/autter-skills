---
name: otel-python-style
description: Wire Autter Runtime into Python backends (Django, FastAPI, Flask, Celery, plain WSGI/ASGI) with the standard OpenTelemetry SDK and Runtime's copied autter_tracing.py, which keeps every error even under head sampling. Configure errors with codes, usage, LLM tracing, optional OTLP logs and request summaries; verify exporters and stored evidence.
metadata:
  version: "1.4.0"
  tags: [autter, telemetry, python, fastapi, flask, django, celery, opentelemetry, llm, logging, requests, errors]
  author: autter
---

# Python style

For continuous detection, add database, outbound HTTP, and queue
instrumentations in addition to framework spans. A failed normal return can
be reported with an `autter.outcome` OTel event carrying
`autter.outcome.status=error`, a stable `autter.outcome.name`, and a short
`autter.outcome.message`; set the span status to ERROR. Symbolized pprof
from a supported profiler can be uploaded to `/v1/profiles`. The optional
`adapters/python/caught_exceptions.py` hook samples handled exceptions but
uses Python tracing and must be enabled explicitly for targeted diagnosis.

There is no `autter` Python package — Autter Runtime's ingester speaks
standard **OTLP/HTTP**, so the official `opentelemetry-sdk`,
`opentelemetry-exporter-otlp-proto-http` and the framework's
`opentelemetry-instrumentation-*` package do the work. Use the HTTP
exporter: the ingester has no gRPC endpoint. Two files from Runtime's
[`adapters/python`](https://github.com/Autter-dev/autter-runtime/tree/main/adapters/python)
are copied into the project, next to the code that starts tracing:

- [`autter_tracing.py`](https://github.com/Autter-dev/autter-runtime/blob/main/adapters/python/autter_tracing.py):
  `init_tracing()` and the always-on error pieces it wires (below). Without
  it, a ratio sampler drops every error of the traces it drops: at 1%, 99%
  of exceptions never leave the process.
- [`redact.py`](https://github.com/Autter-dev/autter-runtime/blob/main/adapters/python/redact.py):
  the secret and PII scrubbing `autter_tracing.py` applies before export
  (stdlib only).

Source of truth for this skill: Runtime's
[Python integration guide](https://github.com/Autter-dev/autter-runtime/blob/main/docs/INTEGRATIONS.md#python-django-fastapi-flask-celery)
and its tested recipes in
[`examples/python`](https://github.com/Autter-dev/autter-runtime/tree/main/examples/python)
(Django, FastAPI, Flask, Celery). Per-framework wiring, what each
instrumentation records, and troubleshooting:
[Framework reference](references/frameworks.md).

## Install

Inspect existing initialization first. Reuse its providers and exporters; do not add a second SDK.
When the service already builds its own `TracerProvider`, keep it and wrap
its sampler and exporting processor as in
[Wiring an existing provider](#wiring-an-existing-provider) instead of
calling `init_tracing()`.

## Structured logs and operation evidence

Check the deployed ingester supports `/v1/logs` and migration
`0011-runtime-logs` before enabling log export. Configure the installed Python
SDK's logs provider, batch processor, OTLP/HTTP log exporter and a `logging`
bridge. In a prefork server, initialize them per worker after fork. Reuse
existing logging and provider ownership; exporter environment variables alone
do not install a logging bridge. The Python logs API varies by SDK version,
so check its installed signatures rather than inventing imports.

Use the server Runtime key, shared service/environment/release resource and
active trace/span context. With the current SDK (underscore `_logs` modules;
check your installed version):

```python
import logging
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

def init_logs(resource, headers):
    provider = LoggerProvider(resource=resource)
    provider.add_log_record_processor(BatchLogRecordProcessor(
        OTLPLogExporter(endpoint="https://otlp.autter.dev/v1/logs", headers=headers)))
    set_logger_provider(provider)
    summaries = logging.getLogger("autter.requests")
    summaries.addHandler(LoggingHandler(level=logging.INFO, logger_provider=provider))
    summaries.setLevel(logging.INFO)
    summaries.propagate = False  # keep summaries out of the app's stdout handlers
    return provider
```

Call it from `init_observability` with the same `resource` and `headers`.
Attach the `LoggingHandler` to other loggers only where the user wants those
diagnostics in Autter. Export to the ingester's `/v1/logs`; ordinary
warnings/error logs are diagnostic records, not automatically grouped issues.
Keep exception and failed `autter.outcome` trace events for issue capture.
Do not install Node logging APIs or imitate their async-local implementation.
For custom operation summaries, follow the
[operation contract](https://docs.autter.dev/runtime/operation-logging#other-languages-and-existing-otlp-loggers)
and explicitly share captured operation IDs with traces. Queue workflow IDs
alone do not create that link.

Scrub structured context before export, preserve bounded retry/buffer settings,
and await logs and trace/metric flushing on worker shutdown or short-lived jobs.
Configure these limits in Python/your collector; Node's buffer/retry limits do
not apply to external exporters. Verify stored logs, context and trace IDs in
**Runtime → Logs** separately from trace/metric/LLM verification. Use only
isolated test traffic; inspect existing production telemetry. Missing storage
is unavailable, not evidence of a healthy empty service. The platform readers
and fix worker need a matching deployment; logs may arrive after initial RCA.

## Coded errors and request summaries

There is no Python Runtime package; these are attribute contracts that any
OTel SDK can send. Codes and request columns are stored only by a **1.5.0+**
ingester (self-hosted: migrations `0012`, `0013`). On an older ingester the
attributes are accepted and ignored; report codes and request summaries as
pending rather than verified.

**Error codes.** Put these on the exception event (preferred) or the span:

| Attribute | Value |
| --- | --- |
| `autter.error.code` | `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$`, ≤ 80 chars: namespaced, stable, no ids/PII (`billing.declined`) |
| `autter.error.why` / `autter.error.fix` | Declared cause / remedy, ≤ 1000 chars each, no PII |
| `autter.error.link` | Docs URL, ≤ 500 chars |
| `autter.error.expected` | `True` for business failures (declines, validation): recorded, never an incident |

One code = one issue per service, across message variants and connected
Sentry/PostHog sources. An invalid code is ignored and the error groups by
stack/message as before. Never invent codes for third-party exceptions; keep
existing exception messages unchanged while adding codes.

```python
def autter_error_attributes(err):
    attrs = {f"autter.error.{k}": getattr(err, k) for k in ("code", "why", "fix", "link")
             if isinstance(getattr(err, k, None), str) and getattr(err, k)}
    if getattr(err, "expected", False):
        attrs["autter.error.expected"] = True
    return attrs

# in the central error handler, for an existing AppError class with a `code`:
span = trace.get_current_span()
span.record_exception(err, attributes=autter_error_attributes(err))
```

**Request summaries over OTLP logs.** One log record per request, emitted when
the response is done, makes the request visible in **Runtime → Logs →
Requests** with its request id. Summaries are always kept: skip only health
and metrics routes. This needs the logs provider below (`init_logs`).

```python
# autter_requests.py
import logging, re, time, uuid
from opentelemetry import trace

SKIP = {"/healthz", "/metrics"}
_summaries = logging.getLogger("autter.requests")
_REQUEST_ID = re.compile(r"^[\w.-]{8,128}$")

def request_id_from(value):
    return value if value and _REQUEST_ID.match(value) else str(uuid.uuid4())

def emit_request_summary(method, route, status, started, request_id, outcome=None, code=None):
    outcome = outcome or ("failed" if status >= 500 else "succeeded")
    trace.get_current_span().set_attribute("autter.request.id", request_id)
    attrs = {
        "autter.event.type": "operation",
        "autter.operation.kind": "request",
        "autter.operation.id": uuid.uuid4().hex,
        "autter.operation.name": f"{method} {route}",
        "autter.operation.outcome": outcome,  # succeeded|failed|degraded|cancelled
        "autter.operation.duration_ms": round((time.monotonic() - started) * 1000, 1),
        "autter.request.id": request_id,
        "http.request.method": method,
        "http.route": route,               # the template, never the raw path
        "http.response.status_code": status,
    }
    if code:
        attrs["autter.error.code"] = code
    level = logging.ERROR if outcome == "failed" else logging.INFO
    _summaries.log(level, f"{method} {route}", extra=attrs)
```

Wire it per framework, inside the OTel instrumentation so the server span is
current. Error handlers may set `autter_outcome` (`"degraded"` for expected
coded errors) and `autter_error_code` on the request state.

```python
# FastAPI / Starlette
@app.middleware("http")
async def autter_requests(request, call_next):
    if request.url.path in SKIP:
        return await call_next(request)
    started = time.monotonic()
    request.state.request_id = rid = request_id_from(request.headers.get("x-request-id"))
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["x-request-id"] = rid
        return response
    finally:
        route = getattr(request.scope.get("route"), "path", "unmatched")
        emit_request_summary(request.method, route, status, started, rid,
                             getattr(request.state, "autter_outcome", None),
                             getattr(request.state, "autter_error_code", None))
```

- **Flask:** set `g.autter_started` and `g.request_id` in `@app.before_request`;
  in `@app.after_request` use `request.url_rule.rule if request.url_rule else
  "unmatched"`, set the `x-request-id` header and call `emit_request_summary`.
- **Django:** a middleware class near the top of `MIDDLEWARE`; after
  `get_response`, the route is `"/" + request.resolver_match.route` (or
  `"unmatched"`). Django already turns exceptions into 500 responses there.
- Cross-origin browser clients need `Access-Control-Expose-Headers:
  x-request-id` in the CORS config to read the id.
- Never add bodies, headers, emails or tokens to the summary attributes.

## Endpoint regression requirements

The general setup below also needs explicit-bucket **delta** HTTP duration histograms for endpoint detection. Configure the installed metric exporter for delta temporality; do not leave its cumulative default unchanged. Export at most two minutes apart. Set route templates, HTTP methods, the deployed commit SHA, stable service and environment names, and a unique service instance ID.

For memory pressure, the Python OTel exporter is only transport. Add a current
RSS gauge from `psutil` (or an existing process metrics instrument) to the
same meter provider using `autter.process.memory.rss`, unit `By`. Configure
this inside each worker after fork, so `service.instance.id` identifies one
process lifetime. See Runtime's `docs/MEMORY-PRESSURE.md` for the shared
contract, supported GC counters, and OOM event forwarding. Do not map
`resource.getrusage().ru_maxrss` or `tracemalloc` to current RSS.
Self-hosted ingesters need 1.3.3+ for memory signals.
Redeploy the Python workers after adding the gauge; an OTLP exporter alone
does not start measuring RSS. Metric-based detection works without a platform
forwarder, but OOM/restart correlation requires one that sends the matching
process instance ID to `/v1/platform-events`.

Keep normal trace sampling. Add slow-request retention only through a supported SDK or collector policy; `retainTracesAboveMs` is a Node/Next.js option, not a Python option. Capture database and dependency child spans for trace comparison. Do not infer p95 from sampled traces. The platform rollout does not change these application settings.

Self-hosted ingesters require 1.3.1 or later. See the [telemetry contract](https://github.com/Autter-dev/autter-runtime/blob/main/docs/ENDPOINT-REGRESSIONS.md). Draft fixes need human review. Verify with existing production telemetry, not artificial errors or requests. Run any selftest below only in an isolated test environment.

## Packages

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
pip install psutil  # only when using the RSS gauge below
# Framework instrumentation (pick what matches):
pip install opentelemetry-instrumentation-django    # Django
pip install opentelemetry-instrumentation-fastapi   # FastAPI
pip install opentelemetry-instrumentation-flask     # Flask
pip install opentelemetry-instrumentation-celery    # Celery workers
```

Add them to the project's own dependency file (requirements, Poetry, uv)
rather than installing ad hoc. Then copy the two adapter files from Runtime
`main` next to the module that starts tracing (the Django project package,
the FastAPI/Flask app module, the Celery app module):

```bash
curl -fsSO https://raw.githubusercontent.com/Autter-dev/autter-runtime/main/adapters/python/autter_tracing.py
curl -fsSO https://raw.githubusercontent.com/Autter-dev/autter-runtime/main/adapters/python/redact.py
```

Commit both files. They need `opentelemetry-sdk` (tested with 1.20, 1.27,
1.41 and 1.45) and nothing else; `init_tracing()`'s default exporter needs
`opentelemetry-exporter-otlp-proto-http`.

## Configuration: environment variables

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.autter.dev
OTEL_EXPORTER_OTLP_HEADERS=x-autter-key=${AUTTER_RUNTIME_KEY}
OTEL_SERVICE_NAME=<service name>
OTEL_RESOURCE_ATTRIBUTES=service.instance.id=${PROCESS_INSTANCE_ID},service.version=${GIT_SHA},deployment.environment.name=production
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.01
```

- `OTEL_EXPORTER_OTLP_ENDPOINT` is the base URL; the exporter appends
  `/v1/traces` (and `/v1/metrics`). A self-hosted ingester URL replaces it.
- Send the server key as `x-autter-key=<key>`: header values in
  `OTEL_EXPORTER_OTLP_HEADERS` are URL-encoded, and this one needs no space.
  `authorization=Bearer%20<key>` also works. Never write the key's value
  into a file; reference `AUTTER_RUNTIME_KEY` by name.
- `service.version` is the release (the deployed commit SHA).
- The ratio is for healthy traffic only. With `init_tracing()`, errors are
  exported whatever the ratio; keep 1% unless the user asks otherwise.

Only use the environment resource ID when the deployment supplies a distinct
`PROCESS_INSTANCE_ID` to **each worker**. With a prefork server and one shared
environment value, configure the resource after fork in worker startup instead.

## Default path: `init_tracing()`

`init_tracing()` builds and registers the tracer provider from the variables
above, so errors are always exported while healthy traces keep the ratio:

- `RecordUnsampled(sampler)` turns the head sampler's *drop* into *record
  only*: unsampled spans still reach the span processors, keep the attributes
  they started with and the not-sampled flag, and propagate it downstream.
- `RetainErrorTraces(processor)` holds the unsampled spans of each trace and,
  once one of them ends with an `exception` event or ERROR status, sends the
  whole local trace to the batch processor: the spans that ended before (the
  failing child, the queries before it) and those that end later (the request
  span). A healthy trace is dropped when its first local span ends. Bounded:
  256 spans per trace, 5,000 buffered spans and traces, 30 s per trace.
- Spans exported this way carry `autter.tail_retained = true`, as
  `@autter/runtime-node`'s retained traces do: the ingester counts no request
  from them (they are not a traffic sample) and counts each error once.
  Head-sampled spans export unchanged.
- `RedactingSpanExporter` scrubs span names, attributes, status messages,
  exception messages and tracebacks (chained causes included) with
  `redact.py` before export; `redact.configure(value_patterns=[...],
  key_patterns=[...])` adds project patterns.

Every request is recorded as if sampled, but only sampled and failing traces
are exported. Call `init_tracing()` once in every process that serves
requests or runs tasks, at startup, before the framework instrumentation:

| Framework | Where | What |
| --- | --- | --- |
| Django | `wsgi.py` / `asgi.py`, before `get_wsgi_application()` / `get_asgi_application()` | `init_tracing()`, `DjangoInstrumentor().instrument()`; add `ClientErrorResponses` to `MIDDLEWARE` |
| FastAPI | the module that creates the app | `init_tracing()`, then `FastAPIInstrumentor.instrument_app(app)` |
| Flask | the app module | `init_tracing()`, `app = Flask(__name__)`, `FlaskInstrumentor().instrument_app(app)` |
| Celery | a `worker_process_init` receiver (prefork, solo); `worker_init` for threads/gevent/eventlet | `init_tracing()`, `CeleryInstrumentor().instrument()` |

The code for each, Django's `ClientErrorResponses` middleware and the
Celery receivers are in the [Framework reference](references/frameworks.md).
gunicorn imports the WSGI/app module in each worker; with `--preload` it
imports it once before forking, and the exporter thread and the error buffer
restart in each worker. A process that already has an SDK provider (a second
call, or `opentelemetry-instrument`) keeps it: `init_tracing()` returns it
and warns when its sampler drops errors.

Turn on request counting in the same call. Without it, request counts read
only the head-sampled traces while every error is kept, so at a 1% ratio error
rates (release health, the post-deploy check of Autter's fixes) read about a
hundred times too high, and a meter provider's default **cumulative**
`http.server.duration` is not counted at all. `count_requests=True` (or
`AUTTER_COUNT_REQUESTS=true`) records every HTTP request once, sampled or not,
in a delta histogram on `/v1/metrics`, and registers its meter provider as
the global one. Do not register another meter provider: if one already exists
when `init_tracing()` runs, counting stays off with a warning.

```python
# observability.py
import os
import uuid

from opentelemetry.sdk.resources import Resource

from autter_tracing import init_tracing


def init_observability():
    # OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES fill in the rest.
    resource = Resource.create({
        "service.instance.id": os.environ.get("AUTTER_RUNTIME_INSTANCE_ID") or str(uuid.uuid4()),
    })
    # Endpoint, key header and sampler come from the OTEL_* variables;
    # errors are exported whatever the ratio, and every request is counted.
    init_tracing(resource=resource, count_requests=True)
```

It needs `opentelemetry-exporter-otlp-proto-http` and an `autter_tracing.py`
copied after 2026-10-24: an older copy rejects `count_requests`, so copy it
again. It works with ingester 1.8.0 and later, hosted or self-hosted. The framework instrumentations' own HTTP
duration histograms are dropped so no request is counted twice. gRPC server
spans keep their span-fed counts.

Add this after `init_observability()` in each worker. It adds a gauge to the
helper's meter provider and does not initialize another SDK:

```python
import psutil
from opentelemetry import metrics
from opentelemetry.metrics import Observation

process = psutil.Process()
metrics.get_meter("autter-process-memory").create_observable_gauge(
    "autter.process.memory.rss",
    callbacks=[lambda options: [Observation(process.memory_info().rss)]],
    unit="By",
)
```

For OOM correlation, set `AUTTER_RUNTIME_INSTANCE_ID` to a platform ID that
the ECS/Kubernetes event forwarder can report. Each worker needs a distinct
ID; a pod UID alone is insufficient for multiple workers or restarts.

## Wiring an existing provider

When the service already constructs its own `TracerProvider` (custom
exporters, extra processors, a GenAI sampler), wrap what is there instead of
calling `init_tracing()`:

```python
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

from autter_tracing import RecordUnsampled, RedactingSpanExporter, RetainErrorTraces

provider = TracerProvider(
    resource=resource,
    # RecordUnsampled outermost: it must see the final drop decision of every
    # sampler inside it (LlmAwareSampler included).
    sampler=RecordUnsampled(LlmAwareSampler(ParentBased(TraceIdRatioBased(ratio)))),
)
# Replaces the plain BatchSpanProcessor(exporter): keeping both exports every
# sampled span twice.
provider.add_span_processor(
    RetainErrorTraces(BatchSpanProcessor(RedactingSpanExporter(OTLPSpanExporter())))
)
trace.set_tracer_provider(provider)
```

Drop `LlmAwareSampler` when the service makes no LLM calls (see
[LLM calls](#llm-calls)). Every other processor the service registers keeps
working; only the exporting one is wrapped.

## Zero-code: `opentelemetry-instrument`

`opentelemetry-instrument` (from `opentelemetry-distro`) configures the SDK
from environment variables alone and auto-instruments the frameworks and
libraries it detects. Its sampler comes from `OTEL_TRACES_SAMPLER`, and no
standard sampler keeps the errors of the traces it drops, so at a ratio
sampler it loses most errors. Prefer `init_tracing()`. When the user wants
the wrapper anyway, either:

- run it at full sampling, `OTEL_TRACES_SAMPLER=parentbased_always_on`,
  which exports every trace: raise this with the user first, since it is
  their cost; or
- sample everything in the SDK the same way and put an OpenTelemetry
  Collector with the `tail_sampling` processor (an ERROR status policy plus
  a small probabilistic one) in front of the ingester, so it decides what is
  exported.

Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` with the wrapper: the
distro defaults to gRPC. HTTP metrics ride along on this path:
`opentelemetry-instrument` also wires a meter provider, and the framework
instrumentations emit `http.server.duration`. It does not guarantee a
process memory gauge; add the gauge above if no existing instrument emits it.
If `init_tracing()` also runs under the wrapper it leaves the wrapper's
provider in place and logs `init_tracing(): an OpenTelemetry TracerProvider
is already registered` when that sampler drops errors.

## Framework notes

Read the [Framework reference](references/frameworks.md) for the code. In short:

- **Django**: OpenTelemetry's Django middleware records Django's 500 on the
  request span, and also `Http404`, `PermissionDenied`, `BadRequest` and
  `SuspiciousOperation`. Add the `ClientErrorResponses` middleware from
  Runtime's Django recipe so 404s do not become issues.
- **FastAPI / Flask**: exceptions that escape the app are recorded. An
  `@app.exception_handler` (FastAPI) or `@app.errorhandler` (Flask) that
  answers an exception hides it: the 500 reaches Autter as a stackless
  `HttpServerError`. Record the exception inside such handlers.
  `HTTPException` / `abort()` responses are not recorded.
- **Celery**: set tracing up in `worker_process_init`, as OpenTelemetry's
  Celery instrumentation requires; task failures are recorded on the task's
  `run/<task name>` span.
- **macOS development only**: `gunicorn --preload` workers die with
  `objc[…]: … fork() was called` (set
  `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` locally), and Celery's prefork
  pool needs `FORKED_BY_MULTIPROCESSING=1`. Linux is unaffected.

## Reporting errors

The framework instrumentation records unhandled exceptions on the request
or task span. For code with no instrumentation (CLI scripts, cron jobs,
custom consumers), start a span and **let the exception propagate**:
`start_as_current_span` records it and sets ERROR status on exit.

```python
tracer = trace.get_tracer(__name__)

with tracer.start_as_current_span("job.process_payment"):
    do_work()  # an exception is recorded once, with its traceback, and re-raised
```

Do not call `span.record_exception(e)` and re-raise inside that `with`
block: the span records the exception again on exit, and two exception events
on one span are two occurrences in Autter. When you need to add attributes
before re-raising, start the span with `record_exception=False`:

```python
with tracer.start_as_current_span("job.process_payment", record_exception=False) as span:
    try:
        do_work()
    except PaymentError as exc:
        span.record_exception(exc, attributes={"payment.attempt": attempt})
        raise  # ERROR status is still set on exit
```

Handled exceptions that should still be seen are recorded on the current
span, which inside a request is the request span and inside a Celery task
the task span, without re-raising:

```python
from opentelemetry import trace

try:
    refund_card(order_id)
except RefundPending as exc:
    trace.get_current_span().record_exception(exc, attributes={"autter.handled": True})
    return JsonResponse({"status": "pending"}, status=202)
```

Errors surface as Autter issues whenever a span records an exception
(`span.record_exception`) or ends with `ERROR` status. `record_exception`
sends `exception.type` (`module.Class`, e.g. `shop.payments.RefundPending`;
builtins bare, e.g. `KeyError`), `exception.message` and
`exception.stacktrace`, the whole formatted traceback; keep it, do not strip
it. A handled exception's traceback starts at the function that caught it.

How Autter groups Python errors (`frames-v3`): the traceback is parsed
innermost frame first, with line numbers. A chained exception ("During
handling of the above exception…", "The above exception was the direct
cause…") contributes the frames of the exception that was reported; an
exception group (3.11+) contributes its own frames, not its
sub-exceptions'. In-app frames are the project's files: `site-packages`,
`dist-packages` and the standard library (`<frozen …>` modules,
`lib/python3.X/`) are excluded. The issue key is the error type plus up to
five in-app `function@file` frames, so line numbers and ids in messages do
not split an issue across deploys, while two Celery tasks failing in one
helper stay two issues. One error recorded on two spans of a request (the
request span and a span of your own around the call) is one occurrence when
both arrive in the same export batch. The exception-group and
standard-library rules are live on the hosted ingester; self-hosted
ingesters need the first release after 1.7.0 (1.7.0 and older group those
errors by their message or by standard library frames).

## The user behind a request, and an ID they can quote

Where the app resolves the signed-in user (auth middleware, a dependency, a
decorator), put the opaque id the support tool knows the customer by on the
request's server span. Errors recorded on that span carry it:

```python
from opentelemetry import trace

trace.get_current_span().set_attribute("enduser.id", str(user.id))  # opaque id only, never an email or a name
```

Autter uses it to link support tickets and "it didn't work" reports to that
customer's errors. Skip it, and say so in the hand-off, when the app only knows
users by email.

When a request fails, the app's error page or error body can show the user
the trace id, labelled so a ticket that quotes it matches:

```python
ctx = trace.get_current_span().get_span_context()
trace_id = trace.format_trace_id(ctx.trace_id) if ctx.is_valid else None
# render f"Trace ID: {trace_id}" on the error page / in the JSON error body
```

That changes what users see: propose it and add it with the user's go-ahead.

## Intentional warning issues

Autter stores warnings alongside errors with a `severity` column
(`fatal | error | warning | info`) — declared via the `autter.severity`
attribute on the exception event. Use this only when the warning intentionally
needs issue grouping. Ordinary deprecations, retries, and recovered failures
belong in the logs pipeline described above:

```python
with tracer.start_as_current_span("orders.legacy_lookup") as span:
    span.add_event("exception", {
        "exception.type": "DeprecationWarning",
        "exception.message": "Legacy /orders lookup used",
        "autter.severity": "warning",
    })
```

The exception event creates an occurrence; `autter.severity` assigns warning
severity. Do not mark an otherwise successful span ERROR just to export a log.
Keep messages as stable templates
— ids and numbers are normalised out server-side for grouping — and never
include PII.

## Instrumenting slow processes (jobs, consumers, crons)

Autter's dashboard flags processes that are slow AND repeating a lot
(performance incidents with an automated optimization analysis and, when
safe, an automated fix PR). HTTP routes are covered automatically via
unsampled request metrics; non-HTTP work is only visible where a span
exists. Wrap recurring units of work — cron jobs, queue consumers, batch
scripts; Celery tasks already get a span from `CeleryInstrumentor` — in a
span named after the job:

```python
with tracer.start_as_current_span("invoice.rebuild"):
    rebuild_invoices()
```

Failing jobs are always exported (`RetainErrorTraces`), but healthy ones are
head-sampled like any other trace: at 1%, their counts are a lower bound.
When accurate counts matter, exempt the job span names in the head sampler
the same way `LlmAwareSampler` exempts GenAI spans (below), inside
`RecordUnsampled`. Use stable, low-cardinality span names; put ids in
attributes.

## LLM calls

Autter recognises spans following the OTel GenAI semconv (`gen_ai.*`
attributes) automatically and records each as an LLM call — model, tokens,
latency, USD cost (estimated ingest-side unless the span reports
`autter.llm.cost_usd`) — watched for spend spikes, failing models, and
budget breaches. If the service calls LLM APIs (deps: `openai`,
`anthropic`, `litellm`, `langchain`, `google-genai`, `boto3` Bedrock),
wire this alongside the rest.

**Emitting the spans.** Prefer the official GenAI instrumentations:

```bash
pip install opentelemetry-instrumentation-openai-v2   # openai client
# anthropic/bedrock/vertex equivalents exist under opentelemetry-instrumentation-*
```

Under `opentelemetry-instrument` they activate automatically; in explicit
setups call `OpenAIInstrumentor().instrument()` after
`init_observability()`. Leave
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` unset (default off) —
prompts/completions must not leave the service. For clients without an
instrumentation, a manual span with the semconv attributes does the same:

```python
from opentelemetry.trace import SpanKind

with tracer.start_as_current_span(
    "chat gpt-5-mini",
    kind=SpanKind.CLIENT,
    attributes={
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-5-mini",
        "autter.user_id": user_id,  # opaque id — never an email
    },
) as span:
    out = client.chat.completions.create(...)
    span.set_attribute("gen_ai.usage.input_tokens", out.usage.prompt_tokens)
    span.set_attribute("gen_ai.usage.output_tokens", out.usage.completion_tokens)
```

**Sampling exemption — required.** At the 1% ratio sampler, 99% of
successful LLM spans are dropped and the cost numbers become garbage
(`RetainErrorTraces` keeps only the failing ones). Exempt GenAI spans in the
head sampler (Autter's Node package does exactly this internally):

```python
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, Sampler

class LlmAwareSampler(Sampler):
    """Always sample GenAI spans; delegate everything else."""
    def __init__(self, delegate):
        self._delegate = delegate

    def should_sample(self, parent_context, trace_id, name, kind=None,
                      attributes=None, links=None, trace_state=None):
        target = self._delegate
        if name.startswith(("chat ", "embeddings ", "gen_ai.", "ai.")) or any(
            key.startswith("gen_ai.") for key in (attributes or {})
        ):
            target = ALWAYS_ON
        return target.should_sample(parent_context, trace_id, name, kind,
                                    attributes, links, trace_state)

    def get_description(self):
        return f"LlmAware({self._delegate.get_description()})"
```

Pass it to `init_tracing()`, which wraps it in `RecordUnsampled` (the
outermost sampler):

```python
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

ratio = float(os.environ.get("OTEL_TRACES_SAMPLER_ARG", "0.01"))
init_tracing(resource=resource, sampler=LlmAwareSampler(ParentBased(TraceIdRatioBased(ratio))))
```

The zero-code `opentelemetry-instrument` path can't take a custom sampler
from env vars — for services where LLM tracing matters, use `init_tracing()`
so the exemption exists; otherwise tell the user their successful LLM calls
are 1%-sampled.

## Selftest path (temporary — delete after verification)

Throwaway routes that prove the pipelines. Add them, verify, delete them —
never commit or deploy them.

```python
# TEMPORARY autter selftest — delete after verification.
# (FastAPI shown; Flask/Django: same bodies in their route syntax.)
@app.get("/__autter-selftest")
def autter_selftest():
    from opentelemetry import metrics, trace

    tracer = trace.get_tracer("autter-selftest")
    with tracer.start_as_current_span("autter.selftest") as span:
        span.add_event("exception", {
            "exception.type": "Message",
            "exception.message": "autter selftest",
            "autter.severity": "info",
            "autter.error.code": "autter_selftest.message",  # 1.5.0+ ingester groups by it
        })
        span.set_status(trace.Status(trace.StatusCode.ERROR, "autter selftest"))

    # LLM selftest — only when the service is wired for LLM tracing: one
    # fake call (no real model touched) proves gen_ai spans land.
    llm_trace_id = None
    with tracer.start_as_current_span("chat autter-selftest", attributes={
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "autter-selftest",
        "gen_ai.request.model": "autter-selftest",
        "gen_ai.usage.input_tokens": 1,
        "gen_ai.usage.output_tokens": 1,
        "autter.llm.cost_usd": 0,
        "autter.selftest": True,
    }) as llm_span:
        llm_trace_id = format(llm_span.get_span_context().trace_id, "032x")

    trace.get_tracer_provider().force_flush()
    metrics.get_meter_provider().force_flush()
    # The request summary is emitted after this returns and ships on the
    # log batch timer (about a second), not by this flush.
    return {"ok": True, "llm_trace_id": llm_trace_id}


@app.get("/__autter-selftest/error")
def autter_selftest_error():
    # Unhandled on purpose: the app's usual 500, recorded with its traceback.
    raise RuntimeError("autter selftest error")
```

The `force_flush()` calls make the first route deterministic — exports fire
before the response returns, no waiting on batch/interval timers. The ERROR
status sits on the internal child span (that status is what makes the
ingester store the info-severity occurrence), not on the request span, so the
route doesn't show up as a failed request in traffic stats.

No sampling override is needed for the error signals: with `init_tracing()`,
the selftest span and the error route's exception are exported at any ratio,
marked `autter.tail_retained`. Only the LLM selftest span depends on the
`LlmAwareSampler` exemption; without one, raise the ratio for the
verification run only (`OTEL_TRACES_SAMPLER_ARG=1`) and drop it afterwards.

## Verify

1. Start the app with its normal configuration (the production ratio).
2. `curl` `/__autter-selftest` once — it returns `{"ok": true}` only after
   both force-flushes ran — then `/__autter-selftest/error` once (a 500).
3. Check the process output: the OTLP exporters log failed exports
   (a `401` means the key is missing/wrong; connection errors mean
   egress to `otlp.autter.dev` is blocked). No export errors means both
   `/v1/traces` and `/v1/metrics` were accepted. A
   `init_tracing(): an OpenTelemetry TracerProvider is already registered`
   warning means the app runs under `opentelemetry-instrument` with a ratio
   sampler: see [Zero-code](#zero-code-opentelemetry-instrument).
4. Ground truth in the dashboard (~1–2 min): an `autter.selftest` span,
   one info-severity "autter selftest" issue, one `RuntimeError` "autter
   selftest error" issue for the error route whose stack shows the selftest
   function as its in-app frame — once, not a stackless `HttpServerError` —
   and request metrics for `/__autter-selftest`. Those come from the
   `http.server.duration` histogram, which the ingester counts only with the
   delta temporality from [Endpoint regression requirements](#endpoint-regression-requirements)
   (the selftest traces are error traces, retained rather than sampled, so
   they add no request count of their own). Traces arriving without metrics
   means the meter provider isn't registered or still exports cumulative
   histograms — exactly the gap the selftest exists to catch.
5. Logs (when `init_logs` and the request middleware are wired): call the
   route with `-H 'x-request-id: autter-selftest-0001'` and confirm the response
   echoes it, then find a `GET /__autter-selftest` summary with that request id
   under **Runtime → Logs → Requests** (self-hosted: a `runtime_logs` row with
   `kind='request'`). On a 1.5.0+ ingester the selftest issue also shows code
   `autter_selftest.message`. Traces without logs means the logs provider or
   handler is not wired; summaries without request columns means an older
   ingester.
6. LLM-wired services: the `llm_trace_id` call appears under **Runtime →
   LLM** as provider/model `autter-selftest` (self-hosted: a
   `runtime_llm_calls` row). If the ratio was raised for this run, real LLM
   calls only survive the production ratio when the `LlmAwareSampler`
   exemption is in place — double-check it's wired before trusting this
   signal.
7. Trigger one real exception path too and confirm it arrives with its
   traceback (wrap it per [Reporting errors](#reporting-errors) if no
   instrumentation covers that code, e.g. a CLI job) — the selftest proves
   transport, not your error-handler wiring. For Django, also request a
   missing object and confirm no 404 issue appears.
8. Delete the selftest routes and any temporary env override.
