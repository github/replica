# API logging

Hub writes newline-delimited JSON to stdout through the shared logger in `server/integrations/pino/index.ts`. `LOG_LEVEL` sets the minimum severity and defaults to `info`. Allowed values are `trace`, `debug`, `info`, `warn`, `error`, `fatal`, and `silent`; an invalid value prevents startup.

Log collection, access, retention, and deployment configuration are outside this integration. Logs can contain private information even after key redaction. Treat access to logs accordingly.

## Application events

Import the explicit logging function from its directory:

```ts
import { log } from "../integrations/pino/log/index.ts"

log("info", "Build imported", { buildId })
```

Pass structured fields rather than interpolating user input into messages. Keep messages static and never put credentials, raw requests, or private content into a message or stack trace. Sensitive values in free text cannot be reliably detected.

Handlers can use `request.log.info({ buildId }, "Build imported")` to include the request ID automatically. The helper also accepts a request logger as its fourth argument: `log("info", "Build imported", { buildId }, request.log)`.

Utilities cannot import integrations. Repositories and other integrations must receive a logger explicitly if they need one; domains and HTTP setup may import the Pino integration. Do not bind request payloads with `logger.child()` or `setBindings()`: arbitrary Pino bindings do not pass through the structured-field sanitizer.

## Automatic HTTP records

`createApp()` registers `createRequestLogger()` once, before JSON parsing and routes. Every request gets a server-generated UUID returned in `X-Request-Id`; incoming request ID headers are not trusted. Body parsing accepts JSON with Express's default 100 KiB limit.

The middleware emits one terminal record with `reqId`, `method`, `route`, `statusCode`, `responseTime` in milliseconds, and `outcome`. Completed responses below 400 use `info`, 4xx use `warn`, and 5xx or connection errors use `error`. An unfinished connection uses `outcome: "aborted"` and `statusCode: null`, even if headers were already sent.

`route` is the handler's Express route template, such as `/builds/:id`, or `null` for an unmatched request. For mounted routers it is relative to the mount: Express exposes concrete mount values, not a safe complete template. The middleware captures route parameters when headers are written, before Express can restore outer-router parameters. It also captures the sanitized query and parsed JSON body at that point. Later mutations during a streaming response do not change the snapshot.

Automatic records omit raw URLs, headers, cookies, raw or malformed bodies, uploads, response bodies, and error messages or stacks. Parser errors receive a generic JSON error response. Errors after headers are sent close the connection rather than sending raw errors to Express's default reporter.

An endpoint handling sensitive content can exclude all payload fields before sending its response:

```ts
response.locals.omitLogPayload = true
```

This omits `params`, `query`, and `body`, but retains the method, route template, request ID, timing, and outcome.

## Structured-field safety

The shared logger sanitizes structured event fields, including fields passed to `request.log`. Request snapshots use the same sanitizer without mutating the request.

Sensitive keys are replaced with `[REDACTED]`. Matching ignores case and punctuation and covers keys containing password, passwd, passphrase, secret, token, authorization, cookie, API key, private key, or session ID. The sanitizer visits nested objects and arrays; it does not search arbitrary string values for secrets. Endpoint authors must exclude payloads containing private free text or fields not covered by those key rules.

Each top-level structured field is limited to 8 KiB of serialized JSON, six nesting levels, 100 visited entries, and 2,048 characters per string. Field names are capped at 128 characters. An event includes at most 100 caller-supplied top-level fields, plus a truncation marker when that limit is exceeded. Explicit markers identify redaction, truncation, cycles, unavailable getters, unsupported values, and oversized fields. The limits apply to structured fields, not Pino's message or custom bindings. Use short, static messages.

The sanitizer copies ordinary objects, arrays, and Error data properties without invoking getters or custom `toJSON()` methods. Unsupported object instances are omitted with a marker. These bounds prevent log payloads from growing without limit; they are not a substitute for input validation or endpoint-specific privacy decisions.
