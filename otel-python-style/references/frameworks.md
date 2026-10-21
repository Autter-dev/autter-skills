# Python framework reference

Read this when wiring a Django, FastAPI, Flask or Celery service, after the
setup in the [Python style skill](../SKILL.md). Each section is the tested
recipe from Runtime's
[`examples/python`](https://github.com/Autter-dev/autter-runtime/tree/main/examples/python),
whose tests start the app configured by the `OTEL_*` variables alone, at
sampling ratio 0, trigger an unhandled and a handled exception, and check the
exported `exception` event, route, status and resource. Background:
[Runtime's Python guide](https://github.com/Autter-dev/autter-runtime/blob/main/docs/INTEGRATIONS.md#python-django-fastapi-flask-celery).

`autter_tracing.py` and `redact.py` sit next to the module that imports
them. Where the snippets call `init_tracing()`, call the skill's
`init_observability()` instead when the service also registers a meter
provider there.

## Django

Start tracing in the WSGI/ASGI module, before Django loads its middleware.
`runserver` and gunicorn import it in the process that serves requests:

```python
# <project>/wsgi.py (asgi.py: the same, with get_asgi_application)
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "<project>.settings")

from autter_tracing import init_tracing
from opentelemetry.instrumentation.django import DjangoInstrumentor

init_tracing()
DjangoInstrumentor().instrument()

from django.core.wsgi import get_wsgi_application

application = get_wsgi_application()
```

**What is recorded.** OpenTelemetry's Django middleware, which
`instrument()` inserts first in `MIDDLEWARE`, records an exception that
escapes a view on the request span in `process_exception`, with ERROR status
and the 500. The span's `http.route` is Django's route pattern, without a
leading slash (`orders/<int:order_id>/charge`).

**404s are not errors.** The same middleware also records `Http404`,
`PermissionDenied`, `BadRequest` and `SuspiciousOperation` as exceptions with
ERROR status, so every `get_object_or_404` miss would become an issue. Add
this middleware, copied from Runtime's
[Django recipe](https://github.com/Autter-dev/autter-runtime/blob/main/examples/python/django/shop/middleware.py),
anywhere in `MIDDLEWARE`: Django calls `process_exception` from the last
middleware to the first, so it answers those exceptions with Django's own
response before OpenTelemetry's middleware sees them.

```python
# <project>/middleware.py
from django.core.exceptions import BadRequest, PermissionDenied, SuspiciousOperation
from django.core.handlers.exception import response_for_exception
from django.http import Http404

CLIENT_ERRORS = (Http404, PermissionDenied, BadRequest, SuspiciousOperation)


class ClientErrorResponses:
    """Answer Django's 4xx exceptions before OpenTelemetry records them."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        if isinstance(exception, CLIENT_ERRORS):
            return response_for_exception(request, exception)
        return None
```

```python
# <project>/settings.py
MIDDLEWARE = [
    # ...the existing middleware...
    "<project>.middleware.ClientErrorResponses",
]
```

**Not recorded:** an exception another middleware's `process_exception`
turns into a response never reaches OpenTelemetry's middleware. Record it
there with `trace.get_current_span().record_exception(exc)`.

## FastAPI

```python
from autter_tracing import init_tracing
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

init_tracing()  # uvicorn --workers N imports this module in each worker

app = FastAPI()
# ...routes...
FastAPIInstrumentor.instrument_app(app)
```

**What is recorded.** The ASGI middleware records an exception that escapes
the app (Starlette's 500) on the request span. Its `http send` child span of
that 500 also ends with ERROR status and no exception; the ingester folds it
into the request's error when both reach it in one export batch.
`FastAPIInstrumentor.instrument_app(app, exclude_spans=["send", "receive"])`
drops those per-message spans altogether. Handled exceptions recorded in a
sync route (run in the thread pool) still land on the request span.

**Not recorded:** `HTTPException` (a response, not an error), and any
exception an `@app.exception_handler` answers: the 500 then arrives as a
stackless `HttpServerError`. Record the exception in the handler:

```python
from fastapi.responses import JSONResponse
from opentelemetry import trace


@app.exception_handler(PaymentError)
async def payment_error(request, exc):
    trace.get_current_span().record_exception(exc)
    return JSONResponse({"error": "payment failed"}, status_code=502)
```

## Flask

```python
from autter_tracing import init_tracing
from flask import Flask
from opentelemetry.instrumentation.flask import FlaskInstrumentor

init_tracing()  # gunicorn imports this module in each worker (once before forking with --preload)

app = Flask(__name__)
FlaskInstrumentor().instrument_app(app)
```

**What is recorded.** An exception that escapes a view (Flask's 500) is
recorded on the request span when the request is torn down.

**Not recorded:** `abort()` / `HTTPException` responses, and any exception an
`@app.errorhandler` answers (a stackless `HttpServerError` again). Record it
in the handler:

```python
from opentelemetry import trace


@app.errorhandler(PaymentError)
def payment_error(exc):
    trace.get_current_span().record_exception(exc)
    return {"error": "payment failed"}, 502
```

## Celery

Set tracing up in each worker process, as OpenTelemetry's Celery
instrumentation requires: its exporter thread must start after the fork.
The prefork pool sends `worker_process_init` in each child process, and the
solo pool once in the worker:

```python
# the Celery app module (celery -A <module> worker)
from autter_tracing import init_tracing
from celery import Celery
from celery.signals import worker_process_init
from opentelemetry.instrumentation.celery import CeleryInstrumentor

app = Celery("shop")


@worker_process_init.connect(weak=False)
def init_worker_tracing(**kwargs):
    init_tracing()
    CeleryInstrumentor().instrument()
```

The threads, gevent and eventlet pools send no `worker_process_init`: connect
the same function to `celery.signals.worker_init` for them instead (not both,
for a prefork worker). A web process that enqueues tasks can call
`CeleryInstrumentor().instrument()` after its own `init_tracing()`, so the
task spans continue the request's trace.

**What is recorded.** A task that raises is recorded on its
`run/<task name>` span (CONSUMER kind) with ERROR status and
`celery.state = FAILURE`; the traceback runs from Celery's tracer into the
task. Every exception that fails a task is recorded, including the ones
declared in `throws=(...)`. A handled exception recorded with
`trace.get_current_span().record_exception(...)` lands on the task span,
which ends with `celery.state = SUCCESS`. Task failures have no HTTP route;
`frames-v3` keeps failures of different tasks apart even when they fail in
the same helper.

## macOS development

Linux deployments are unaffected by both:

- `gunicorn --preload` workers die with `objc[…]: … fork() was called` and
  export nothing: the forked child touches the system proxy settings on its
  first export. Set `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` in the local
  environment. Plain OpenTelemetry fails the same way.
- Celery's billiard starts prefork pool children with spawn on macOS, and the
  pool then fails every task (`not enough values to unpack`) unless
  `FORKED_BY_MULTIPROCESSING=1` is set. `worker_process_init` fires either
  way.

## Troubleshooting

- **Nothing arrives.** The exporter logs failed exports: a 401 is a missing
  or wrong key, a connection error the endpoint or egress.
  `OTEL_EXPORTER_OTLP_ENDPOINT` is the base URL;
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` takes the full `…/v1/traces` URL.
- **Errors arrive, healthy requests rarely.** The head sampler at work, as
  intended. Error traces carry `autter.tail_retained = true`.
- **No errors either.** `init_tracing()` did not run in the process that
  serves the requests: a module only a parent process imports, or a Celery
  pool child without the `worker_process_init` receiver.
- **`init_tracing(): an OpenTelemetry TracerProvider is already registered`.**
  The app runs under `opentelemetry-instrument` with a ratio sampler: see the
  skill's Zero-code section.
- **Every Django 404 is an issue.** Add `ClientErrorResponses`.
- **A stackless `HttpServerError` for a 500.** The framework or an error
  handler answered the exception before the instrumentation saw it: record it
  there (above). For FastAPI's `http send` span, keep
  `OTEL_BSP_SCHEDULE_DELAY` at its default so a request's spans export
  together, or exclude those spans.
- **Each error counted twice.** Code that calls `span.record_exception()` and
  re-raises inside `start_as_current_span` records it twice on one span: see
  the skill's Reporting errors section.
