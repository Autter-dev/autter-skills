---
name: otel-python-style
description: Wire Autter Runtime into Python backends using the standard OpenTelemetry SDK. Configure errors with codes, usage, LLM tracing, OTLP logs and request summaries; verify exporters and stored evidence.
metadata:
  version: "1.4.0"
  tags: [autter, telemetry, python, fastapi, flask, django, opentelemetry, llm, logging, requests, errors]
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
standard **OTLP/HTTP**, so any language with an OTel SDK works by pointing
it at the ingester. For Python, use the official `opentelemetry-sdk` +
`opentelemetry-exporter-otlp-proto-http` (or `-grpc`, if the user already
has a gRPC-friendly deployment — HTTP is simpler and what Autter's ingester
documents first).

## Install

Inspect existing initialization first. Reuse its providers and exporters; do not add a second SDK.

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
# Framework auto-instrumentation (pick what matches):
pip install opentelemetry-instrumentation-fastapi   # FastAPI
pip install opentelemetry-instrumentation-flask     # Flask
pip install opentelemetry-instrumentation-django    # Django
```

## Fastest path: zero-code env vars

If the user just wants it working with minimal code changes, use
`opentelemetry-instrument` (from `opentelemetry-distro`,
`pip install opentelemetry-distro opentelemetry-instrumentation`) as a
process wrapper, with standard OTel env vars:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.autter.dev
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer ${AUTTER_RUNTIME_KEY}"
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=<service name>
OTEL_RESOURCE_ATTRIBUTES=service.instance.id=${PROCESS_INSTANCE_ID},service.version=${GIT_SHA},deployment.environment.name=production
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.01
```

```bash
opentelemetry-instrument python app.py
# or: opentelemetry-instrument gunicorn app:app
```

Only use the environment resource ID when the deployment supplies a distinct
`PROCESS_INSTANCE_ID` to **each worker**. With a prefork server and one shared
environment value, configure the resource after fork in worker startup instead.

This auto-instruments whatever frameworks it detects (FastAPI, Flask,
requests, urllib, psycopg2, etc.) with zero code changes. Prefer this when
the user wants the least invasive setup.

HTTP metrics ride along on this path: `opentelemetry-instrument`
also wires a meter provider from the same env vars, and the framework
instrumentations emit the `http.server.duration` histogram — the one
instrument Autter folds into unsampled request rollups (and what gives
the slow-process monitor accurate HTTP coverage). It does not guarantee a
process memory gauge; add the gauge below if no existing instrument emits it.

## Explicit setup (when the user wants code they can see/modify)

```python
# observability.py
import os
import uuid

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

def init_observability(service_name: str, api_key: str):
    resource = Resource.create({
        "service.name": service_name,
        "service.instance.id": os.environ.get("AUTTER_RUNTIME_INSTANCE_ID") or str(uuid.uuid4()),
        "service.version": os.environ.get("GIT_SHA", ""),
        "deployment.environment.name": os.environ.get("DEPLOYMENT_ENVIRONMENT", "production"),
    })
    headers = {"authorization": f"Bearer {api_key}"}

    # 1% of successful traces. Reading the ratio from the standard env var
    # lets a verification run force 100% (OTEL_TRACES_SAMPLER_ARG=1)
    # without touching code.
    ratio = float(os.environ.get("OTEL_TRACES_SAMPLER_ARG", "0.01"))
    provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(ratio)),
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
        endpoint="https://otlp.autter.dev/v1/traces",
        headers=headers,
    )))
    trace.set_tracer_provider(provider)

    # Metrics are not optional: the framework instrumentors only emit the
    # http.server.duration histogram — what feeds Autter's unsampled
    # request rollups and slow-process monitor — once a meter provider is
    # registered. Without this block, usage stats degrade to 1%-sampled
    # trace rollups.
    metrics.set_meter_provider(MeterProvider(
        resource=resource,
        metric_readers=[PeriodicExportingMetricReader(
            OTLPMetricExporter(
                endpoint="https://otlp.autter.dev/v1/metrics",
                headers=headers,
            ),
            export_interval_millis=60_000,
        )],
    ))
    return provider
```

Add this after the meter provider is registered in each worker. It uses the
same exporter and does not initialize another SDK:

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

Call `init_observability(...)` once per process, before it starts serving
traffic (after fork in prefork servers, or in an ASGI lifespan startup hook) — and
**before** the framework instrumentor runs, since instrumentors bind to
whatever providers are registered at instrument time.

**FastAPI**: `FastAPIInstrumentor.instrument_app(app)` after creating the
app — do this instead of hand-writing middleware.

**Flask**: `FlaskInstrumentor().instrument_app(app)` right after
`app = Flask(__name__)`.

**Django**: `DjangoInstrumentor().instrument()` before `django.setup()` /
at the top of `wsgi.py`/`asgi.py`.

## Reporting errors manually

Automatic instrumentation records exceptions on the current span
automatically for most frameworks. For code outside a request context
(background jobs, CLI scripts, Celery tasks), wrap manually:

```python
tracer = trace.get_tracer(__name__)

with tracer.start_as_current_span("job.process_payment") as span:
    try:
        do_work()
    except Exception as e:
        span.record_exception(e)
        span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
        raise
```

Errors surface as Autter issues whenever a span records an exception
(`span.record_exception`) or ends with `ERROR` status — this is standard
OTel behavior, not something Autter needs configured separately.
`record_exception` attaches the traceback; Autter parses the Python stack
format server-side and groups by the top function and file, so the same
defect stays one issue across re-deploys (line numbers are ignored) and two
different defects that share a message stay separate. Keep the traceback on
the event; do not strip it.

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
exists. Wrap recurring units of work — Celery tasks, cron jobs, queue
consumers, batch scripts — in a span named after the job:

```python
with tracer.start_as_current_span("invoice.rebuild"):
    rebuild_invoices()
```

At the default 1% ratio sampler these job spans would mostly be dropped —
route them through an always-on tracer (a separate `TracerProvider` with
an `ALWAYS_ON` sampler, same pattern the error path uses) or accept that
counts are a lower bound. Use stable, low-cardinality span names; put ids
in attributes.

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
`init_observability(...)`. Leave
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

**Sampling exemption — required.** At the 1% ratio sampler, 99% of LLM
spans are dropped and the cost numbers become garbage. Exempt GenAI spans
in the sampler (Autter's Node package does exactly this internally); in
`init_observability`, wrap the sampler:

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

# in init_observability:
#   sampler=LlmAwareSampler(ParentBased(TraceIdRatioBased(ratio)))
```

The zero-code `opentelemetry-instrument` path can't take a custom sampler
from env vars — for services where LLM tracing matters, use the explicit
setup (above) so the exemption exists; otherwise tell the user their LLM
calls are 1%-sampled.

## Selftest path (temporary — delete after verification)

A throwaway route that proves both pipelines in one hit. Add it, verify,
delete it — never commit or deploy it.

```python
# TEMPORARY autter selftest — delete after verification.
# (FastAPI shown; Flask/Django: same body in their route syntax.)
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
```

The `force_flush()` calls make it deterministic — both exports fire
before the response returns, no waiting on batch/interval timers. The
ERROR status sits on the internal child span (that status is what makes
the ingester store the info-severity occurrence), not on the request
span, so the route doesn't show up as a failed request in traffic stats.

One catch: the selftest span is a child of the request span, so at the
default 1% sampling it's usually dropped before export. Force sampling up
for the verification run only:

```bash
OTEL_TRACES_SAMPLER_ARG=1 opentelemetry-instrument python app.py
# explicit setup: init_observability reads the same env var
```

## Verify

1. Start the app with `OTEL_TRACES_SAMPLER_ARG=1` set for this run.
2. `curl` the selftest route once — it returns `{"ok": true}` only after
   both force-flushes ran.
3. Check the process output: the OTLP exporters log failed exports
   (a `401` means the key is missing/wrong; connection errors mean
   egress to `otlp.autter.dev` is blocked). No export errors means both
   `/v1/traces` and `/v1/metrics` were accepted.
4. Ground truth in the dashboard (~1–2 min): an `autter.selftest` span,
   one info-severity "autter selftest" issue, and request metrics for
   `/__autter-selftest`. Traces arriving without metrics means the meter
   provider isn't registered (or the instrumentor ran before
   `init_observability`) — exactly the gap the selftest exists to catch.
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
   `runtime_llm_calls` row). Remember the selftest ran with sampling forced
   to 100% — real LLM calls only survive the default 1% run if the
   `LlmAwareSampler` exemption is in place, so double-check it's wired
   before trusting this signal.
7. Trigger one real exception too and confirm `span.record_exception`
   fired (wrap it manually per above if the automatic instrumentation
   doesn't cover that code path, e.g. a background job) — the selftest
   proves transport, not your error-handler wiring.
8. Delete the selftest route and drop the temporary env override.
