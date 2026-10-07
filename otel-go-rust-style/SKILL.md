---
name: otel-go-rust-style
description: Wire Autter Runtime into Go and Rust backends using their OpenTelemetry SDKs. Configure errors with codes, usage, LLM tracing, OTLP logs and request summaries; verify exporters and stored evidence.
metadata:
  version: "1.4.0"
  tags: [autter, telemetry, go, rust, opentelemetry, llm, logging, requests, errors]
  author: autter
---

# Go / Rust style

## Structured logs and operation evidence

Check deployed `/v1/logs` support and migration `0011-runtime-logs` first.
Use the installed language SDK's logs provider/processor/exporter: a trace
exporter alone does not send logs. Go logging needs a compatible bridge for
the logger in use (such as `slog`); Rust needs compatible `tracing`/log bridging
and OTLP logging support. Check current package APIs and reuse existing provider
ownership; do not replace the application logger or install Node APIs.

Send OTLP/HTTP logs with the server Runtime key and the same service,
environment and release resource. Include active trace/span IDs where the
bridge supports them. Ordinary error/warning logs remain diagnostics; keep
exception/ERROR/failed `autter.outcome` traces for issue capture. For custom
operation summaries, follow the
[operation contract](https://docs.autter.dev/runtime/operation-logging#other-languages-and-existing-otlp-loggers)
and share captured operation IDs with traces explicitly. A workflow ID or
timestamp match is insufficient for automatic linking.

Scrub context before export; configure bounded queues, retries, and shutdown
flush in the language SDK or collector. Node limits do not apply to these
exporters. Verify stored messages/context/trace IDs in **Runtime → Logs**
independently from traces, metrics and LLM calls. Run synthetic verification
only in isolated tests; inspect existing production records. Matching platform
readers/fix worker must be deployed; unavailable storage is not empty healthy
telemetry. Refresh evidence or rerun RCA if logs arrive later.

## Coded errors and request summaries (both languages)

These are attribute contracts, not a package. Codes and request columns are
stored only by a **1.5.0+** ingester (self-hosted: migrations `0012`, `0013`);
older ingesters accept and ignore them, so report them as pending there.

| Attribute (exception event preferred, or span) | Value |
| --- | --- |
| `autter.error.code` | `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$`, ≤ 80 chars: namespaced, stable, no ids/PII |
| `autter.error.why` / `autter.error.fix` / `autter.error.link` | Declared cause / remedy / docs URL (≤ 1000 / 1000 / 500 chars) |
| `autter.error.expected` | `true` for business failures: recorded, never an incident |

One code = one issue per service. Never invent codes for third-party errors;
keep existing error messages unchanged while adding codes.

A request summary is one OTLP **log record** per request with:
`autter.event.type="operation"`, `autter.operation.kind="request"`,
`autter.operation.id` (new random id), `autter.operation.name` (`"GET /orders/{id}"`),
`autter.operation.outcome` (`succeeded|failed|degraded|cancelled`),
`autter.operation.duration_ms`, `autter.request.id`, `http.request.method`,
`http.route` (template), `http.response.status_code`, optional
`autter.error.code`. Honour an incoming `x-request-id` matching
`^[\w.-]{8,128}$`, else generate one; echo it as a response header and set it
on the server span. Summaries are always kept: skip only health/metrics
routes. Cross-origin browsers need `Access-Control-Expose-Headers: x-request-id`.
The logs pipeline (next section) must be wired first.

## Detection and telemetry

For continuous detection, instrument outbound requests, database calls,
and queue or job work, not only the inbound router. Mark failed spans ERROR
and record exceptions where the SDK supports it; HTTP 5xx is grouped even
without an exception event. For a known bad normal return, add an
`autter.outcome` event with `autter.outcome.status=error`, stable
`autter.outcome.name`, and short `autter.outcome.message`. A supported
profiler may send symbolized pprof to `/v1/profiles` with a server key and
service, environment, release headers. Caught exception sampling is opt in.

There is no Autter package for Go or Rust — the ingester speaks standard
OTLP/HTTP, so each language's own OTel SDK talks to it directly.

## Go

Before setup, inspect and reuse existing providers and exporters. Do not initialize another SDK.

## Endpoint regression requirements

For Go and Rust, configure the installed metric exporter's temporality selector for **delta**, not cumulative. Use explicit HTTP duration buckets and an export interval of at most two minutes. The general metric examples below need this exporter configuration before endpoint detection can use them. Check the API for the installed SDK version rather than assuming a shared environment variable.

For memory pressure, use that same metric exporter and a unique
`service.instance.id` for each process lifetime. Go's `runtime.MemStats`
provides current `HeapAlloc` plus cumulative `NumGC` and `PauseTotalNs`;
it does not provide process RSS or a container memory limit. Rust needs a
process/allocator collector appropriate to the application. Emit the
portable names and units in Runtime's `docs/MEMORY-PRESSURE.md` and forward
platform OOM/restart events with the server key. Memory sums may be delta or
cumulative; the delta requirement above applies to endpoint histograms.
Self-hosted ingesters need 1.3.3+ for memory signals.
Redeploy the Go/Rust service after wiring those instruments; exporter
configuration alone does not produce process metrics. OOM/restart correlation
requires an external ECS/Kubernetes event forwarder that reports the same
process instance ID to `/v1/platform-events`.

Include route templates, HTTP methods, the deployed commit SHA, stable service and environment names, and a unique service instance ID. Keep normal traces and configure supported slow-request retention where needed. The Node/Next.js `retainTracesAboveMs` option does not apply to Go or Rust. Add dependency child spans; do not calculate endpoint p95 from sampled traces.

Self-hosted ingesters require 1.3.1 or later. See the [telemetry contract](https://github.com/Autter-dev/autter-runtime/blob/main/docs/ENDPOINT-REGRESSIONS.md). The platform rollout does not change application settings. Fixes remain draft pull requests for human review. Use existing production telemetry for verification; run selftests only in an isolated test environment.

## Go packages

```bash
go get go.opentelemetry.io/otel \
       go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
```

```go
import (
    "context"
    "os"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
)

func initObservability(ctx context.Context, serviceName string) (func(context.Context) error, error) {
    exp, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpointURL("https://otlp.autter.dev/v1/traces"),
        otlptracehttp.WithHeaders(map[string]string{
            "authorization": "Bearer " + os.Getenv("AUTTER_RUNTIME_KEY"),
        }),
    )
    if err != nil {
        return nil, err
    }
    res, _ := resource.New(ctx, resource.WithAttributes(
        semconv.ServiceName(serviceName),
        attribute.String("service.instance.id", os.Getenv("AUTTER_RUNTIME_INSTANCE_ID")),
        attribute.String("service.version", os.Getenv("GIT_SHA")),
        attribute.String("deployment.environment.name", os.Getenv("DEPLOYMENT_ENVIRONMENT")),
    ))
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exp),
        sdktrace.WithResource(res),
        sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.01))), // 1%
    )
    otel.SetTracerProvider(tp)
    return tp.Shutdown, nil
}
```

Call `initObservability(ctx, "my-service")` at process start, and call the
returned shutdown func on graceful termination.

**HTTP auto-instrumentation**: wrap the router/mux with
`go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` (or the
framework-specific contrib package — e.g. `otelgin` for Gin, `otelecho` for
Echo) so every request gets a span without manual wiring.

**Reporting errors**:

```go
span := trace.SpanFromContext(ctx)
span.RecordError(err)
span.SetStatus(codes.Error, err.Error())
```

Do this in error-handling middleware so every handler gets it for free,
rather than sprinkling it through business logic. Add the code attributes when
the error carries one (an existing error type with a `Code()` method, say):

```go
var coded interface{ Code() string }
if errors.As(err, &coded) {
    span.RecordError(err, trace.WithAttributes(
        attribute.String("autter.error.code", coded.Code()),
        attribute.Bool("autter.error.expected", isBusinessFailure(err)),
    ))
} else {
    span.RecordError(err)
}
```

**Logs and request summaries (Go).** The Go logs SDK is pre-1.0; check the
installed versions of these modules and keep them in step with the rest of
`go.opentelemetry.io/otel`:

```go
import (
    "go.opentelemetry.io/contrib/bridges/otelslog"
    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
    sdklog "go.opentelemetry.io/otel/sdk/log"
)

lexp, err := otlploghttp.New(ctx,
    otlploghttp.WithEndpointURL("https://otlp.autter.dev/v1/logs"),
    otlploghttp.WithHeaders(map[string]string{
        "authorization": "Bearer " + os.Getenv("AUTTER_RUNTIME_KEY"),
    }),
)
if err != nil {
    return nil, err
}
lp := sdklog.NewLoggerProvider(sdklog.WithResource(res), sdklog.WithProcessor(sdklog.NewBatchProcessor(lexp)))
summaries := otelslog.NewLogger("autter.requests", otelslog.WithLoggerProvider(lp))
// call lp.Shutdown(ctx) alongside the tracer shutdown
```

Wrap the mux **inside** `otelhttp` so the server span is in the context:
`otelhttp.NewHandler(autterRequests(summaries, mux), "server")`.

```go
var requestIDPattern = regexp.MustCompile(`^[\w.-]{8,128}$`)

func newID() string { b := make([]byte, 16); _, _ = rand.Read(b); return hex.EncodeToString(b) } // crypto/rand

type statusWriter struct {
    http.ResponseWriter
    status int
}

func (w *statusWriter) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }

func autterRequests(summaries *slog.Logger, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path == "/healthz" || r.URL.Path == "/metrics" {
            next.ServeHTTP(w, r)
            return
        }
        requestID := r.Header.Get("x-request-id")
        if !requestIDPattern.MatchString(requestID) {
            requestID = newID()
        }
        w.Header().Set("x-request-id", requestID)
        trace.SpanFromContext(r.Context()).SetAttributes(attribute.String("autter.request.id", requestID))
        sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
        started := time.Now()
        defer func() {
            recovered := recover()
            if recovered != nil {
                sw.status = http.StatusInternalServerError
            }
            // Go 1.23+ ServeMux pattern ("GET /orders/{id}"); chi: chi.RouteContext(r.Context()).RoutePattern()
            route := r.Pattern
            if i := strings.IndexByte(route, ' '); i >= 0 {
                route = route[i+1:]
            }
            if route == "" {
                route = "unmatched"
            }
            outcome, level := "succeeded", slog.LevelInfo
            if sw.status >= 500 {
                outcome, level = "failed", slog.LevelError
            }
            summaries.Log(r.Context(), level, r.Method+" "+route,
                "autter.event.type", "operation",
                "autter.operation.kind", "request",
                "autter.operation.id", newID(),
                "autter.operation.name", r.Method+" "+route,
                "autter.operation.outcome", outcome,
                "autter.operation.duration_ms", float64(time.Since(started).Microseconds())/1000,
                "autter.request.id", requestID,
                "http.request.method", r.Method,
                "http.route", route,
                "http.response.status_code", sw.status,
            )
            if recovered != nil {
                panic(recovered)
            }
        }()
        next.ServeHTTP(sw, r)
    })
}
```

If handlers stream or hijack, reuse the repo's existing response-writer wrapper
(or `httpsnoop`) instead of `statusWriter`, which hides `http.Flusher`.

**Intentional warning issues** — add `autter.severity` to an exception event
only when that warning needs issue grouping. Ordinary diagnostics and recovered
failures use the logs pipeline above; do not mark successful spans ERROR just
to export a log:

```go
span.AddEvent("exception", trace.WithAttributes(
    attribute.String("exception.type", "DeprecationWarning"),
    attribute.String("exception.message", "legacy /orders lookup used"),
    attribute.String("autter.severity", "warning"), // fatal|error|warning|info
))
```

## Rust

```toml
# Cargo.toml
opentelemetry = "0.30"
opentelemetry_sdk = "0.30"
opentelemetry-otlp = { version = "0.30", features = ["http-proto"] }
```

```rust
use opentelemetry::KeyValue;
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::{trace::{Sampler, SdkTracerProvider}, Resource};
use std::collections::HashMap;

fn init_observability(service_name: &str) -> anyhow::Result<SdkTracerProvider> {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint("https://otlp.autter.dev/v1/traces")
        .with_headers(HashMap::from([(
            "authorization".to_string(),
            format!("Bearer {}", std::env::var("AUTTER_RUNTIME_KEY")?),
        )]))
        .build()?;

    let resource = Resource::builder()
        .with_service_name(service_name.to_string())
        .with_attributes([
            KeyValue::new("service.instance.id", std::env::var("AUTTER_RUNTIME_INSTANCE_ID").unwrap_or_default()),
            KeyValue::new("service.version", std::env::var("GIT_SHA").unwrap_or_default()),
            KeyValue::new("deployment.environment.name", std::env::var("DEPLOYMENT_ENVIRONMENT").unwrap_or_default()),
        ])
        .build();

    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(0.01)))) // 1%
        .with_resource(resource)
        .build();

    opentelemetry::global::set_tracer_provider(provider.clone());
    Ok(provider)
}
```

(0.30 API: `SdkTracerProvider` and `Resource::builder()`; releases before 0.28
used `TracerProvider` and `Resource::new`. Match the version in `Cargo.lock`.)

Use the `http-proto` feature (protobuf, matches Autter's default) unless
the user's existing exporter setup already uses `http-json`.

**HTTP auto-instrumentation**: for Axum/Actix/Tower-based services, use
`tower-http`'s `TraceLayer` or the framework's tracing middleware, bridged
to OTel via `tracing-opentelemetry`, rather than hand-instrumenting every
handler.

**Reporting errors**:

```rust
let span = tracing::Span::current();
span.record("error", true);
// or, with the raw OTel API on a span directly:
span.record_exception(&err);
span.set_status(opentelemetry::trace::Status::error(err.to_string()));
```

**Codes on Rust errors** — add the attributes to the exception event on the
OTel span (with `tracing-opentelemetry`, reach it through the tracing span):

```rust
use opentelemetry::{trace::TraceContextExt, KeyValue};
use tracing_opentelemetry::OpenTelemetrySpanExt;

let cx = tracing::Span::current().context();
cx.span().add_event("exception", vec![
    KeyValue::new("exception.type", "PaymentDeclined"),
    KeyValue::new("exception.message", err.to_string()),
    KeyValue::new("autter.error.code", err.code()), // e.g. "billing.declined"
    KeyValue::new("autter.error.expected", true),
]);
```

**Logs and request summaries (Rust).** Add `opentelemetry-appender-tracing`
(same minor as `opentelemetry`) and `uuid` (`v4`), build an
`SdkLoggerProvider` with `opentelemetry_otlp::LogExporter::builder().with_http()
.with_endpoint("https://otlp.autter.dev/v1/logs")` and the same headers and
resource, and add `OpenTelemetryTracingBridge::new(&logger_provider)` as a
layer on the existing `tracing_subscriber` registry, filtered to the
`autter.requests` target unless the user wants all events exported. Then an
axum middleware (`.layer(axum::middleware::from_fn(autter_requests))`, inside
the `TraceLayer`):

```rust
use axum::{extract::{MatchedPath, Request}, http::HeaderValue, middleware::Next, response::Response};
use std::time::Instant;

pub async fn autter_requests(req: Request, next: Next) -> Response {
    if matches!(req.uri().path(), "/healthz" | "/metrics") {
        return next.run(req).await;
    }
    let method = req.method().to_string();
    let route = req.extensions().get::<MatchedPath>()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".into());
    let request_id = req.headers().get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| (8..=128).contains(&v.len())
            && v.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c)))
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let started = Instant::now();
    let mut res = next.run(req).await;
    let status = res.status().as_u16() as i64;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        res.headers_mut().insert("x-request-id", value);
    }
    let name = format!("{method} {route}");
    let outcome = if status >= 500 { "failed" } else { "succeeded" };
    tracing::info!(
        target: "autter.requests",
        "autter.event.type" = "operation",
        "autter.operation.kind" = "request",
        "autter.operation.id" = %uuid::Uuid::new_v4().simple(),
        "autter.operation.name" = %name,
        "autter.operation.outcome" = outcome,
        "autter.operation.duration_ms" = started.elapsed().as_secs_f64() * 1000.0,
        "autter.request.id" = %request_id,
        "http.request.method" = %method,
        "http.route" = %route,
        "http.response.status_code" = status,
        "{}", name
    );
    res
}
```

Other tower stacks: the same logic as a `tower::Layer`. Panics are converted
to 500 only if a `CatchPanicLayer` sits inside this middleware.

**Grouping (both languages)**: `RecordError` (Go) and `record_exception`
(Rust) attach the exception type, message, and backtrace. Autter parses the
Go and Rust stack formats server-side and groups by the top function and
file — so the same panic stays one issue across re-deploys (line numbers
and pointer offsets are ignored) and two different panics that share a
message stay separate. Keep the backtrace on the event; do not strip it.
For Rust, build with a backtrace available (`RUST_BACKTRACE=1`, or capture
it in your error type) so the frames reach the exception event.

## Request metrics (both languages)

The trace setup above alone gives Autter only 1%-sampled trace-derived
usage rollups. Unsampled request stats — what the slow-process monitor
uses for accurate HTTP coverage — come from the OTel HTTP-server duration
histogram (`http.server.request.duration`, or the older
`http.server.duration`; Autter's ingester folds exactly these two and
does not treat memory gauges as request metrics), which only exists once a **meter provider** is
registered.

**Go** — add alongside the tracer provider; `otelhttp` then records the
histogram automatically:

```go
import (
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

mexp, err := otlpmetrichttp.New(ctx,
    otlpmetrichttp.WithEndpointURL("https://otlp.autter.dev/v1/metrics"),
    otlpmetrichttp.WithHeaders(map[string]string{
        "authorization": "Bearer " + os.Getenv("AUTTER_RUNTIME_KEY"),
    }),
)
if err != nil {
    return nil, err
}
mp := sdkmetric.NewMeterProvider(
    sdkmetric.WithResource(res),
    sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)), // 60s default
)
otel.SetMeterProvider(mp)
// call mp.Shutdown(ctx) alongside the tracer shutdown
```

Go can then add heap and GC measurements to that provider (after importing
`runtime` and `go.opentelemetry.io/otel/metric` as `metric`):

```go
meter := otel.Meter("autter-process-memory")
heap, _ := meter.Int64ObservableGauge("autter.process.memory.heap.used", metric.WithUnit("By"))
gcCount, _ := meter.Int64ObservableCounter("autter.process.gc.count", metric.WithUnit("{collection}"))
gcMs, _ := meter.Int64ObservableCounter("autter.process.gc.duration", metric.WithUnit("ms"))
_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
    var stats runtime.MemStats
    runtime.ReadMemStats(&stats)
    observer.ObserveInt64(heap, int64(stats.HeapAlloc))
    observer.ObserveInt64(gcCount, int64(stats.NumGC))
    observer.ObserveInt64(gcMs, int64(stats.PauseTotalNs / 1_000_000))
    return nil
}, heap, gcCount, gcMs)
if err != nil { return nil, err }
```

This provides heap-based growth detection without RSS. Add a current RSS
gauge from an OS collector when container-pressure diagnosis is needed; do
not substitute `HeapSys` for a limit. Configure the resource with a full
release SHA and process instance ID, not just a service name.

**Rust** — there is no ubiquitous HTTP-server metrics middleware; either
record the histogram yourself in a small middleware, or tell the user
their usage stats stay trace-derived (a 1%-sampled lower bound). Manual
recording that Autter folds correctly:

```rust
// once, after building an SdkMeterProvider with an OTLP exporter pointed
// at https://otlp.autter.dev/v1/metrics (mirror the trace exporter config):
let hist = opentelemetry::global::meter("http-server")
    .f64_histogram("http.server.request.duration")
    .with_unit("s")
    .build();
// per request, in middleware:
hist.record(elapsed_secs, &[
    KeyValue::new("http.request.method", method),
    KeyValue::new("http.route", route),           // the pattern, not the raw path
    KeyValue::new("http.response.status_code", status as i64),
]);
```

(Metric-SDK builder APIs move between `opentelemetry_sdk` versions —
check the docs of the version you pinned.)

## Instrumenting slow processes (both languages)

Autter's dashboard flags processes that are slow AND repeating a lot
(performance incidents with an automated optimization analysis and, when
safe, an automated fix PR). HTTP routes are covered automatically via
unsampled request metrics; non-HTTP work — background jobs, queue
consumers, cron ticks — is only visible where a span exists. Wrap each
recurring unit of work in a span named after the job (Go:
`tracer.Start(ctx, "invoice.rebuild")` around the job body; Rust: a
`tracing` span bridged via `tracing-opentelemetry`). At the default 1%
ratio sampler these spans would mostly be dropped — give job spans an
always-on tracer provider (same pattern as the error path) or accept that
counts are a lower bound. Stable, low-cardinality names; ids go in
attributes.

## LLM calls (both languages)

Autter recognises spans following the OTel GenAI semconv (`gen_ai.*`
attributes) automatically and records each as an LLM call — model, tokens,
latency, USD cost (estimated ingest-side unless the span reports
`autter.llm.cost_usd`). If the service calls LLM APIs (openai-go,
anthropic SDKs, Bedrock, raw HTTP), wrap each model call in a client span
with the semconv attributes. Go shown; Rust mirrors it with the
`opentelemetry` span API or a `tracing` span whose fields map through
`tracing-opentelemetry`:

```go
ctx, span := tracer.Start(ctx, "chat gpt-5-mini",
    trace.WithSpanKind(trace.SpanKindClient),
    trace.WithAttributes(
        attribute.String("gen_ai.operation.name", "chat"),
        attribute.String("gen_ai.system", "openai"),
        attribute.String("gen_ai.request.model", "gpt-5-mini"),
        attribute.String("autter.user_id", userID), // opaque — never an email
    ))
out, err := client.Chat.Completions.New(ctx, params)
if err != nil {
    span.RecordError(err)
    span.SetStatus(codes.Error, err.Error())
} else {
    span.SetAttributes(
        attribute.Int64("gen_ai.usage.input_tokens", out.Usage.PromptTokens),
        attribute.Int64("gen_ai.usage.output_tokens", out.Usage.CompletionTokens),
    )
}
span.End()
```

Never put prompts, completions, or PII in attributes — model ids, token
counts, and opaque user ids only.

**Sampling exemption — required.** At the 1% ratio sampler, 99% of LLM
spans are dropped and cost numbers become garbage. Either emit LLM spans
from a tracer built on a separate **always-on** provider pointed at the
same exporter (the pattern the slow-process section already uses), or
wrap the root sampler with one that returns "record and sample" whenever
the span name starts with `chat `/`embeddings `/`gen_ai.` or the creation
attributes contain a `gen_ai.*` key, delegating everything else
(implement `sdktrace.Sampler` in Go / `ShouldSample` in Rust — Autter's
Node package does exactly this internally).

## Selftest path (temporary — delete after verification)

A throwaway route that proves both pipelines in one hit — add, verify,
delete; never commit or deploy it. Go shown; mirror the same shape in
Rust:

```go
// TEMPORARY autter selftest — delete after verification.
mux.HandleFunc("/__autter-selftest", func(w http.ResponseWriter, r *http.Request) {
    _, span := otel.Tracer("autter-selftest").Start(r.Context(), "autter.selftest")
    span.AddEvent("exception", trace.WithAttributes(
        attribute.String("exception.type", "Message"),
        attribute.String("exception.message", "autter selftest"),
        attribute.String("autter.severity", "info"),
        attribute.String("autter.error.code", "autter_selftest.message"), // 1.5.0+ ingester groups by it
    ))
    span.SetStatus(codes.Error, "autter selftest")
    span.End()

    // LLM selftest — only when the service is wired for LLM tracing: one
    // fake call (no real model touched) proves gen_ai spans land.
    _, llmSpan := otel.Tracer("autter-selftest").Start(r.Context(), "chat autter-selftest",
        trace.WithSpanKind(trace.SpanKindClient),
        trace.WithAttributes(
            attribute.String("gen_ai.operation.name", "chat"),
            attribute.String("gen_ai.system", "autter-selftest"),
            attribute.String("gen_ai.request.model", "autter-selftest"),
            attribute.Int64("gen_ai.usage.input_tokens", 1),
            attribute.Int64("gen_ai.usage.output_tokens", 1),
            attribute.Float64("autter.llm.cost_usd", 0),
            attribute.Bool("autter.selftest", true),
        ))
    llmTraceID := llmSpan.SpanContext().TraceID().String()
    llmSpan.End()

    tp.ForceFlush(r.Context()) // the TracerProvider from initObservability
    mp.ForceFlush(r.Context()) // the MeterProvider, if wired
    // The request summary is logged after this handler returns and ships on
    // the log batch processor's interval (or lp.Shutdown), not by these flushes.
    w.Write([]byte(`{"ok":true,"llmTraceId":"` + llmTraceID + `"}`))
})
```

The ERROR status lives on the internal child span (that status is what
makes the ingester store the info-severity occurrence), so the request
itself doesn't count as failed in traffic stats. The `ForceFlush` calls
export immediately — no waiting on batch/interval timers. (Rust:
`provider.force_flush()` on both providers.)

At the default 1% ratio the selftest span inherits the request span's
sampling decision and is usually dropped before export: for the
verification run only, set the root sampler to 100%
(`TraceIDRatioBased(1.0)` in Go, `Sampler::TraceIdRatioBased(1.0)` in
Rust) and revert it together with the route.

## Verify (both languages)

1. Build and run with the real `AUTTER_RUNTIME_KEY` value set and the
   root sampler temporarily at 100% (revert after).
2. `curl` the selftest route once — the force-flushes run before it
   returns.
3. Confirm the exporters don't log a connection/auth error on export (a
   401 in exporter logs means the key is missing or wrong; a network error
   means the endpoint URL or outbound egress is blocked). No errors means
   both `/v1/traces` and `/v1/metrics` were accepted.
4. Ground truth in the dashboard (~1–2 min): an `autter.selftest` span,
   one info-severity "autter selftest" issue, and — if the meter provider
   is wired — request metrics for `/__autter-selftest`. Traces arriving
   without metrics means no meter provider: either wire it (section
   above) or tell the user usage stats are trace-derived at 1%.
5. Logs (when the logs provider and request middleware are wired): call the
   route with `-H 'x-request-id: autter-selftest-0001'`, confirm the response
   echoes it, then find a `GET /__autter-selftest` summary with that request id
   under **Runtime → Logs → Requests** (self-hosted: `runtime_logs` with
   `kind='request'`). On a 1.5.0+ ingester the selftest issue shows code
   `autter_selftest.message`. Traces without logs means the logs provider or
   bridge isn't wired; flush/shutdown the logger provider before concluding.
6. LLM-wired services: the returned `llmTraceId` call appears under
   **Runtime → LLM** as provider/model `autter-selftest` (self-hosted: a
   `runtime_llm_calls` row). Remember the selftest ran with sampling at
   100% — real LLM calls only survive the default 1% run with the
   exemption from the LLM section in place; double-check it before
   trusting this signal.
7. Trigger one real error path too and confirm
   `RecordError`/`record_exception` was called on that span — the
   selftest proves transport, not your error-handler wiring.
8. Delete the selftest route and revert the sampling override.
