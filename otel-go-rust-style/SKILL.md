---
name: otel-go-rust-style
version: 1.0.0
description: How to wire Autter Runtime into Go and Rust backends using each language's official OpenTelemetry SDK — no Autter-specific package needed.
tags: [autter, telemetry, go, rust, opentelemetry]
author: autter
---

# Go / Rust style

There is no Autter package for Go or Rust — the ingester speaks standard
OTLP/HTTP, so each language's own OTel SDK talks to it directly.

## Go

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
rather than sprinkling it through business logic.

**Reporting warnings** — same mechanism, plus an `autter.severity`
attribute on the exception event; Autter stores it in the errors table
with `severity: warning` so it groups/aggregates like an error without
being counted as one:

```go
span.AddEvent("exception", trace.WithAttributes(
    attribute.String("exception.type", "DeprecationWarning"),
    attribute.String("exception.message", "legacy /orders lookup used"),
    attribute.String("autter.severity", "warning"), // fatal|error|warning|info
))
span.SetStatus(codes.Error, "deprecated path") // ERROR status makes the ingester pick it up
```

## Rust

```toml
# Cargo.toml
opentelemetry = "0.30"
opentelemetry_sdk = "0.30"
opentelemetry-otlp = { version = "0.30", features = ["http-proto"] }
```

```rust
use opentelemetry_otlp::WithExportConfig;
use std::collections::HashMap;

fn init_observability(service_name: &str) -> anyhow::Result<opentelemetry_sdk::trace::TracerProvider> {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint("https://otlp.autter.dev/v1/traces")
        .with_headers(HashMap::from([(
            "authorization".to_string(),
            format!("Bearer {}", std::env::var("AUTTER_RUNTIME_KEY")?),
        )]))
        .build()?;

    let provider = opentelemetry_sdk::trace::TracerProvider::builder()
        .with_batch_exporter(exporter, opentelemetry_sdk::runtime::Tokio)
        .with_sampler(opentelemetry_sdk::trace::Sampler::ParentBased(Box::new(
            opentelemetry_sdk::trace::Sampler::TraceIdRatioBased(0.01), // 1%
        )))
        .with_resource(opentelemetry_sdk::Resource::new(vec![
            opentelemetry::KeyValue::new("service.name", service_name.to_string()),
        ]))
        .build();

    opentelemetry::global::set_tracer_provider(provider.clone());
    Ok(provider)
}
```

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

## Verify (both languages)

1. Build and run the service with the exporter configured and the real
   `AUTTER_RUNTIME_KEY` value set.
2. Hit any instrumented route once.
3. Confirm the exporter doesn't log a connection/auth error on export (a
   401 in exporter logs means the key is missing or wrong; a network error
   means the endpoint URL or outbound egress is blocked).
4. Trigger one real error path and confirm `RecordError`/`record_exception`
   was called on that span.
