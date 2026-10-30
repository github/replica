# WebSocket updates

Hub can send live updates to the client app and Copilot plugin through the `ws` integration under `server/integrations/ws/`. The integration owns connections and channel subscriptions in one API process. It does not store messages, replay missed events, or deliver between processes.

The application attaches `/api/realtime` to the same HTTP server as Express and passes its broadcast function to `createApp()`. Vite forwards WebSocket upgrades under `/api` during development. The endpoint rejects connections until application access checks are supplied. There are no comment channels or product events yet.

`runApi()` owns the shared server and signal handlers. It waits for HTTP requests and WebSockets to close before the entrypoint flushes [telemetry](telemetry.md). A failure closing either transport is reported after both cleanup operations settle, unless the overall API shutdown deadline expires.

## Server operations

`attachRealtimeServer({ server, path, logger, limits?, authenticate?, authorizeSubscription? })` receives an existing Node HTTP server and an injected Pino logger. It does not start listening or open another port. It returns an instance with two operations:

- `broadcast(channel, { type, payload })` sends a JSON event to that channel's connected subscribers in this process. It validates the event even when there are no subscribers. Invalid input throws; an oversized event throws `RangeError`. Individual connection failures are logged and do not stop delivery to other subscribers. Sending is not an acknowledgment that a client processed the event.
- `close()` returns a promise, stops upgrades, cancels pending admission, clears timers and subscriptions, and closes sockets. It terminates sockets that do not close before the shutdown deadline. Repeated calls return the same promise. The caller still owns the HTTP server. Broadcasting after close throws.

Application startup creates the shared server, attaches WebSockets, and installs Express as its HTTP request handler:

```ts
const server = createServer()
const realtime = attachRealtimeServer({ server, path: "/api/realtime", logger })
server.on("request", createApp({ broadcast: realtime.broadcast }))
server.listen(port)
```

`createApp({ logger?, broadcast? })` and route registration accept an optional broadcast function. Features that receive it can call `broadcast?.(channel, event)` after a successful database commit. Without it, HTTP features work without live updates. Pass the broadcaster explicitly rather than using a global server. If a supplied broadcaster fails, report that failure rather than pretending it sent the update.

Keep comment storage and channel selection in the feature's domain. A feature must not report a saved comment as unsaved merely because a later notification failed.

## Client messages

Browser clients use native `WebSocket`. Other clients use a WebSocket client supported by their runtime. Clients may subscribe and unsubscribe, but cannot publish application events.

| Client message | Server reply |
| --- | --- |
| `{"type":"subscribe","channel":"example:123"}` | `{"type":"subscribed","channel":"example:123"}` |
| `{"type":"unsubscribe","channel":"example:123"}` | `{"type":"unsubscribed","channel":"example:123"}` |

Channel names are case-sensitive, contain 1 to 200 ASCII characters, and start with a letter or digit. Later characters may also contain `:`, `.`, `_`, `/`, or `-`. Repeating a subscription does not add another membership or consume another slot. Unsubscribing from a channel without membership is harmless.

Broadcasts use this shape:

```json
{
  "type": "event",
  "channel": "example:123",
  "event": { "type": "changed", "payload": { "id": "123" } }
}
```

Event types contain 1 to 100 characters; payloads must be JSON values. Feature code owns the payload contract.

Rejected client messages receive `{"type":"error","code":"INVALID_MESSAGE"}` or the same shape with code `FORBIDDEN` or `SUBSCRIPTION_LIMIT`. Invalid JSON, binary messages, unknown operations, extra fields, and invalid channel names are rejected. Logs contain static reasons and connection IDs, not payloads, channel names, credentials, or raw request URLs. The first rejected upgrade per status is logged immediately; repeats are summarized at each heartbeat and shutdown instead of producing an unrestricted stream of rejection logs.

The server installs membership before confirming a subscription. Clients should subscribe, wait for confirmation, then fetch current state. Events received during that fetch must trigger another refresh rather than being overwritten by an older response. Clients must resubscribe and refetch after reconnecting; this integration does not implement client recovery.

## Access checks

The integration does not implement sign-in or choose sessions, tokens, or user records. Application startup may supply:

- `authenticate(request, signal)`: returns the caller's identity, or `null` to reject admission.
- `authorizeSubscription(identity, channel, signal)`: returns whether that caller may subscribe.

These callbacks can be asynchronous. If either callback is missing, upgrades return HTTP 403. Authentication returning `null` produces 401, a failed check produces 500, and an admission timeout produces 408. A denied subscription returns `FORBIDDEN`; a failed subscription check closes the socket with code 1011.

Callbacks must honor their abort signal and finish promptly. Admission timeout, disconnect, and shutdown cancel outstanding checks. Subscription checks also have a deadline. The integration bounds unresolved access checks even if a callback ignores cancellation; capacity remains occupied until those checks settle. Only one subscription check may be outstanding per socket; sending more messages while it is pending closes that socket with code 1008 instead of building a queue.

When authentication is connected, its application policy must also check browser origins, credential expiry, and access revocation for existing subscriptions. Express middleware does not run automatically for WebSocket upgrades. Test-only callbacks that allow synthetic callers must not be used by application startup.

## Resource limits

The defaults in `server/integrations/ws/constants.ts` are initial safety limits, not measured production capacity. Supply positive integer overrides through `limits`. Tune connection limits against measured process memory with headroom before deployment.

| Limit | Default |
| --- | --- |
| Pending and established connections per instance | 1,000 |
| Connections per peer address | 50 |
| Tracked peer addresses | 4,096 |
| Upgrade attempts per peer address per minute | 60 |
| Incoming message and serialized broadcast size | 16 KiB |
| Subscriptions per connection | 32 |
| Client messages, pings, and pongs per connection per second | 20 |
| Queued outgoing bytes per connection | 256 KiB |
| Heartbeat interval | 30 seconds |
| Admission and subscription check deadline | 5 seconds |
| Shutdown deadline | 5 seconds |

Capacity is reserved before asynchronous admission and released on failure or disconnect. Full connection or address-tracking capacity returns HTTP 503; address connection and attempt limits return 429. Idle address counters expire after their attempt window. Compression is disabled. The transport also limits each message to 128 fragments and its receiver to 128 buffered chunks, so tiny fragments cannot bypass the payload byte limit through excessive bookkeeping.

The integration uses the direct peer address and ignores forwarded headers. Behind a proxy, callers may therefore share one address. Operators must configure proxy-side caller limits and tune the peer cap for that topology; do not trust arbitrary forwarded headers. The proxy must support upgrades and limit handshakes and connections before they reach Node. Application limits do not protect against every form of network exhaustion.

Oversized incoming messages close with code 1009. Excess message rates close with 1008. Dead or slow connections are terminated. Heartbeat checks, address tracking, subscriptions, and pending access checks all have bounded state.

## Delivery limits

Any route using the injected broadcaster reaches only this API process. A worker or another API process cannot reach these sockets without a shared signaling layer. Add that layer before porting a feature that publishes across processes.

Notifications are best effort. A client can miss an event while disconnected, and a process can fail between saving a record and publishing. Feature clients should reconcile on reconnect and focus, with periodic refresh if a bounded delay is required. Durable records remain the source of truth.
