# Repository Analytics

Hub keeps repository activity for 90 days whether or not a destination is configured. **Analytics** at `/repositories/:id/analytics` shows configured destinations, not a reporting dashboard. Saving settings does not test a receiving endpoint or confirm that events appear in reports.

## Access and settings

Hosted reads require current GitHub repository `admin` permission, checked independently of Hub administration and Entra roles. An unavailable GitHub permission check does not grant access. Hosted writes are disabled: Hub's fresh administrator authorization does not verify a GitHub repository administrator's specific destination change. Hub does not retain a submitted change while that flow is unavailable.

The fixed local developer can change destinations on a local repository when the loopback development sign-in and local mode are enabled. That exception does not apply to a hosted repository. Outbound delivery and retained-event export are disabled by default, including in local mode.

- **Add destination:** Choose one or more events. Start with **New events only**. A repository can have one Segment destination, one Mixpanel destination, and multiple distinctly named custom destinations, up to 12 destinations in total.
- **Save configuration:** Credentials stay hidden; leave saved fields blank to keep them. Deselecting an event cancels outstanding deliveries of that type. Adding it back does not resend earlier events.
- **Pause / Resume:** Stop or restart delivery without saving configuration edits. New selected events accumulate while paused. An HTTP request already started cannot be recalled.
- **Disconnect:** Delete settings, credentials, and outstanding deliveries without deleting the retained events.

Only an explicit **Include retained events** choice on a new destination can queue history, when an operator has enabled that option. It queues only selected events from that repository and rejects changes that would queue more than 5,000 retained events. Editing never queues history. Disconnecting and adding again with history can resend previously accepted events.

Destination changes have separate security audits. They do not appear in analytics and are not delivered to any provider.

## Events

| Event                       | When Hub records it                             |
| --------------------------- | ----------------------------------------------- |
| `prototype_registered`      | A Prototype first joins the gallery             |
| `prototype_first_published` | Hub stores a Prototype's first successful Build |
| `build_published`           | Hub stores a later successful Build             |
| `review_comment_created`    | A root review comment is created                |
| `review_reply_added`        | A reply is created                              |
| `review_thread_resolved`    | An open thread is resolved                      |
| `review_thread_reopened`    | A resolved thread is reopened                   |

Hub does not count branch discovery, failed Builds, workflow completion without successful Build storage, local editing, or activity inside previews. An existing successful Build is marked as previously published during migration without making up an event. The first-publication marker survives event expiry.

An event has a stable UUID, an event name, a UTC timestamp, and the applicable repository, Prototype, Build, thread, and comment UUIDs. Hub does not export personal identifiers, content, review targets, commit SHAs, branch names, or audit fields. Providers that need an identity receive an event-specific `system/<event UUID>` value, not a person identifier.

## Providers

| Provider    | Regions                             | Credentials                                                          |
| ----------- | ----------------------------------- | -------------------------------------------------------------------- |
| Segment     | US, EU                              | Source write key                                                     |
| Mixpanel    | US, EU, India                       | Owner/Admin service account username, secret, and numeric project ID |
| Custom HTTP | A public HTTPS endpoint on port 443 | Optional named secrets or static headers                             |

Choose the region that matches the source or project. Mixpanel sends one event using strict import. Hub sends no synthetic test events.

Custom destinations send one JSON POST per event. URLs cannot contain credentials, fragments, or credential-like query keys. Use named secrets instead of putting credentials in a URL or template literal. Header names such as `Host`, `Cookie`, proxy and hop-by-hop fields, and `X-Replica-Event-Id` are reserved. A saved static header appears as `{"$keep":true}` and keeps its value only for the same header name. To remove a named secret, remove its row and its references.

```json
{
  "Authorization": { "$secret": "service_token" },
  "X-Channel": "replica"
}
```

In the JSON request template, use a whole-value `{"$field":"…"}` reference to insert `event_id`, `event_name`, `occurred_at`, `repository_id`, `prototype_id`, or `properties`. `properties` contains only the applicable scoped IDs. `build_id`, `thread_id`, and `comment_id` may be absent and require a scalar `when_missing` fallback. `actor_id` is always absent and uses its declared fallback. Whole-value `{"$secret":"…"}` references also work in the body. Templates are bounded and do not support expressions or interpolation. Preview uses redacted sample values and makes no network request.

Any 2xx response accepts a custom request unless you specify a JSON Pointer and expected JSON scalar, such as `/result/accepted` and `true`. Response text is never persisted. **Needs attention** indicates failure without showing the provider's response.

Changing a custom URL, template, header, response rule, or secret cancels unsent work. The **Same recipient** option keeps pending and retryable deliveries only for authentication changes that preserve the endpoint, body, response rule, and unrelated headers. A worker already sending is never rebound to new credentials. Check the provider's own retention before exporting events.

## Operations

Recorders write each fact and its delivery rows in the product transaction. The on-demand BullMQ worker sends deliveries; the scheduled worker recovers due work each minute and purges expired events and their deliveries hourly. Queue insertion failures leave durable work for later recovery. Separate enqueue claims and send leases recover abandoned work. Retryable failures use backoff and at most eight attempts with the same event UUID. Delivery is at least once; the provider is responsible for deduplication.

Before any approved export, set a dedicated `HUB_ANALYTICS_ENCRYPTION_KEY` containing 32 base64-encoded random bytes on the API and both workers. Back it up with deployment secrets. A loopback-only API can use the configured local authentication key for settings while export is disabled; use a stable key before saving settings you need after restart. Changing the key does not re-encrypt saved settings.

`HUB_ANALYTICS_OUTBOUND_ENABLED=true` allows real delivery. `HUB_ANALYTICS_ALLOW_RETAINED_EXPORT=true` separately permits the explicit backfill choice. Neither should be enabled without approval. Use the same `HUB_APPLICATION_ORIGIN` and `HUB_PREVIEW_ORIGIN` across processes. `REPLICA_ANALYTICS_OUTBOUND_HOSTS` can restrict custom destinations to a comma-separated list of exact DNS hostnames.

The HTTP client rejects redirects, ignores environment proxies, checks both DNS address families for private or reserved addresses on every attempt, pins an approved IP, and verifies TLS for the original hostname. It does not send for removed repositories or expired events. Keep production egress policy as a second boundary.
