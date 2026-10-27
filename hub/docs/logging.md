# API logging

Hub writes one JSON object per line to stdout through `server/integrations/pino/index.ts`. `LOG_LEVEL` sets the minimum severity: `trace`, `debug`, `info` (default), `warn`, `error`, `fatal`, or `silent`. Invalid values prevent startup.

Logs can still contain private information after redaction. Operators must restrict access and configure collection and retention separately.

## Application events

Use `log()` for application events:

```ts
import { log } from "../integrations/pino/log/index.ts"

log("info", "Build imported", { buildId })
```

Keep messages short and static. Pass data as structured fields, not message text. Redaction matches keys; it cannot detect secrets in free text, including messages and stacks.

In handlers, use `request.log.info({ buildId }, "Build imported")` to include the request ID, or pass `request.log` as the fourth argument to `log()`.

Follow the [import boundaries](backend-architecture.md#import-boundaries). Repositories and other integrations must receive a logger rather than import Pino's shared instance. Never put payloads in `logger.child()` or `setBindings()`: those fields bypass sanitization.

## Automatic HTTP records

`createApp()` installs request logging before JSON parsing and routes. Every endpoint inherits it. Each request gets a server-generated UUID in the `X-Request-Id` response header; incoming IDs are ignored.

Each request produces one final record with `reqId`, `method`, `route`, `statusCode`, `responseTime` (milliseconds), and `outcome`. Responses below 400 use `info`, 4xx use `warn`, and 5xx or connection errors use `error`. Interrupted responses have `outcome: "aborted"` and `statusCode: null`.

`route` is the handler's template, such as `/builds/:id`, or `null` when unmatched. Mounted routers use a relative template to avoid exposing actual mount values. Sanitized parameters, query fields, and parsed JSON bodies are copied when headers are sent, before Express clears route data.

Automatic records exclude raw URLs, headers, cookies, uploads, response bodies, and error details. JSON parsing uses Express's default 100 KiB limit; rejected bodies are not logged. The Express error handler returns generic JSON errors, or closes the connection if headers were sent, without exposing raw errors.

For private free text or other sensitive payloads, exclude all payload fields before sending a response:

```ts
response.locals.omitLogPayload = true
```

This omits `params`, `query`, and `body` while keeping request metadata.

## Structured-field safety

Application fields, `request.log` fields, and automatic payloads share the same sanitizer. It copies data without changing the request or invoking getters or custom serialization methods.

Keys containing password, passwd, passphrase, secret, token, authorization, cookie, API key, private key, or session ID become `[REDACTED]`. Matching ignores case and punctuation and includes nested objects and arrays. Exclude payloads whose sensitive fields do not match these rules.

Structured fields have [size, depth, and entry limits](../server/utils/logging/sanitize-log-value/constants.ts). Markers replace truncated data, cycles, getters, and unsupported values. These limits do not apply to messages or custom bindings and do not replace endpoint validation or privacy decisions.
