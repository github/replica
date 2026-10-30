# Telemetry

Hub operators can send explicitly recorded server-side traces to an OpenTelemetry Protocol (OTLP) recipient of their choice. Tracing is disabled by default. Configuration belongs to the operator's process environment, not to an API endpoint or browser setting.

The foundation provides two functions under `server/integrations/opentelemetry/`: `startTelemetry()` and `withTelemetrySpan()`. It does not automatically trace requests, database queries, outbound HTTP, or jobs. The health endpoint does not produce spans. Browser tracking and durable product analytics are not implemented.

## Configure export

Set these variables in the API and worker environments, or in a private local `.env`:

```sh
OTEL_TRACES_EXPORTER=otlp
OTEL_SERVICE_NAME=replica-hub
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=1
```

The recipient can be a provider that accepts OTLP over HTTP/protobuf or an operator-managed OpenTelemetry Collector that forwards to other platforms. Use HTTPS for remote recipients. This integration does not include provider-specific SDKs, configure a Collector, or prove that a provider displays accepted traces.

| Variable | Contract |
| --- | --- |
| `OTEL_TRACES_EXPORTER` | `none` is the default; `otlp` enables export. Other values fail startup. |
| `OTEL_SDK_DISABLED` | `true`, ignoring case, disables telemetry regardless of other settings. With export enabled, other nonempty values must be `false`. |
| `OTEL_SERVICE_NAME` | Defaults to `replica-hub`. Use a static service label of at most 100 printable characters, not secrets or personal data. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Explicit absolute HTTP(S) URL with a request path. Credentials, query strings, and fragments are rejected. |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | Only `http/protobuf` is supported. |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | Optional comma-separated URL-encoded `key=value` authentication headers. For example, `Authorization=Bearer%20example`. Keep real values private. |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` is the default. `always_on` and `always_off` are also supported. Other samplers fail startup. |
| `OTEL_TRACES_SAMPLER_ARG` | A finite fraction from `0` through `1`, defaulting to `1`, controls the root sampling ratio. It is validated but has no effect for `always_on` and `always_off`. |

Common `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, and `OTEL_EXPORTER_OTLP_HEADERS` settings are also accepted. Trace-specific settings take precedence, even when empty. The common endpoint is a base URL; Hub appends `/v1/traces` to its path. Enabled export requires an explicit endpoint. Disabled telemetry does not validate unused export settings or create an exporter.

Hub sets its own resource, sampler, batching, and context policies rather than loading arbitrary SDK environment configuration. `OTEL_RESOURCE_ATTRIBUTES`, other sampler names, automatic instrumentation, and custom propagation are not part of this contract. Do not infer support for every standard OpenTelemetry variable.

## Process lifetime

`startTelemetry(process.env, logger)` validates enabled configuration and registers one tracer provider and asynchronous context manager per process. The logger is supplied by composition code; this integration does not import the Pino integration. A second enabled initialization before shutdown is rejected.

The API and worker entrypoints already call it before accepting requests or starting consumers. Static imports are sufficient because this foundation does not patch dependencies. `createApp()` does not initialize global telemetry or install signal handlers.

The returned `{ shutdown() }` belongs to the entrypoint, not to domains or request handlers. The entrypoint waits for API requests or active worker jobs to drain, then awaits shutdown in `finally`. API and worker drain limits are 30 seconds; telemetry shutdown adds at most five seconds. Operators must allow both windows before terminating a process. Startup failures and shutdown timeouts exit unsuccessfully.

Shutdown flushes queued spans and closes the SDK. It is idempotent, including when telemetry is disabled. Normal batching holds at most 256 spans, exports at most 64 per batch, and attempts export at one-second intervals with a two-second export timeout. Queue saturation or failed delivery can lose spans. Export failures produce safe static logs, not errors in the feature being traced. Shutdown failure is reported separately and rejects the shutdown call.

## Trace a ported feature

Call `withTelemetrySpan()` around one meaningful operation in a route or domain. From a function directory under `server/domains/build/`, wrapping an existing `importBuild()` operation would look like:

```ts
import { withTelemetrySpan } from "../../../integrations/opentelemetry/with-telemetry-span/index.ts"

return withTelemetrySpan(
  "build.import",
  { "replica.build.id": buildId },
  () => importBuild(buildId),
)
```

The callback runs once. The helper awaits it, returns its original result, and finishes the span on success or failure. A failure marks the span as failed and rethrows the exact original value. It does not attach exception messages, stacks, or thrown objects. A failed operation is not converted into a successful result.

Nested calls become parent and child spans across `await`; concurrently running operations keep their contexts separate. Disabled or unsampled telemetry still runs the callback normally. Completed spans receive success or failure status without additional diagnostic payloads.

Use static operation names such as `build.import`, not record IDs, branch names, URLs, or user input. Names contain at most 100 lowercase ASCII letters, digits, and separating `.`, `_`, or `-` characters, beginning with a letter. Format validation cannot determine whether a name is genuinely static; reviewers must check the call site.

Attributes accept only these optional UUID strings:

- `replica.repository.id`
- `replica.prototype.id`
- `replica.build.id`
- `replica.thread.id`
- `replica.comment.id`

The integration validates names and attributes before invoking the callback, even when tracing is disabled. Unknown keys and malformed IDs reject with a safe error instead of silently recording unexpected data. An invalid instrumentation call is a programming error, not an exporter outage. To add an attribute, update the integration's type, runtime schema, this guide, and privacy coverage together.

Do not pass request or response bodies, headers, cookies, credentials, SQL, job arguments, review text, profile fields, or raw exceptions. IDs are pseudonymous, not anonymous. Exported data needs operator-controlled access and retention. Pino redaction does not sanitize traces. Use this wrapper rather than directly modifying SDK spans or importing the OpenTelemetry API in feature code.

## Architecture and future ports

Keep configuration and telemetry-specific helpers inside `integrations/opentelemetry/`. Use one function directory with colocated types and tests; do not add a barrel export, telemetry domain, or telemetry utilities outside the integration.

Follow the [backend import boundaries](backend-architecture.md#import-boundaries). Domains and routes may call the integration. Repositories and other integrations must receive a tracing callback from composition code rather than import OpenTelemetry integration functions or types. Business decisions about what to trace stay with the feature.

There is no request-header extraction, outbound context injection, baggage handling, or job-context transport yet. Each independently started operation is a root unless it already has an active in-process parent. Adding cross-process propagation requires a real feature boundary and an explicit policy for trusted incoming context; never assume client-supplied trace headers are trusted. Automatic instrumentation may need earlier initialization or ESM loader support and must be verified for the selected libraries before changing startup.

Sampled, best-effort traces explain execution. They are not durable usage counts, security audits, or delivery guarantees. Port product analytics separately when its domains, access checks, transactional events, and delivery requirements exist.

## Verify a port

Add a colocated test that proves the operation's span, safe attributes, result, and failure behavior. Keep the actual SDK and asynchronous context handling real; replace only export transport when network delivery is not under test. Release the runtime and any test-owned global providers or context managers after each case.

From `hub/`, run the foundation checks with:

```sh
npm test -- server/integrations/opentelemetry server/run-api
```

For an actual recipient check, configure a local OTLP receiver and invoke an instrumented operation. Visiting the health route alone cannot verify export. A receiver accepting a batch does not establish that an analytics or APM report contains it.
