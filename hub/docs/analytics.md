# Repository analytics

Hub records repository activity when a Prototype is registered, a Build is published, or a review conversation changes. It keeps the events for 90 days, even when no analytics destination exists. Repository administrators can send selected events to Segment, Mixpanel, or their own public HTTPS endpoint from **Analytics**.

Security decisions, including destination changes, use the separate [security audit](security-audit.md). They are never delivered to analytics destinations.

## Settings

Open **Analytics** above the account avatar, or visit `/repositories/:id/analytics`. Hub checks current GitHub admin permission on reads and every change. If GitHub cannot confirm access, Hub denies it. There is no Hub-wide analytics administrator.

Every GitHub-backed destination mutation also requires [fresh GitHub authorization](fresh-authorization.md) on the same browser Session. When verification is needed, Hub temporarily encrypts the submitted settings and credentials without changing the destination. Verify the same account and Hub continues that specific action through its normal permission checks. Failed or cancelled verification discards the saved settings.

The isolated local-development demo keeps its existing analytics editing without pretending to verify GitHub identity. This exception applies only to the local developer acting on a configured local repository with local mode enabled. Local mode requires development, an explicit flag, and a localhost Hub origin; production rejects it. No other sensitive operation receives this exception.

Choose **Add destination** beside **Destinations**, then select a provider, credentials, and event types. Segment and Mixpanel each allow one destination per repository; custom HTTP destinations have distinct names and can be added more than once. Select a region for Segment or Mixpanel. All seven event types are selected initially. Use an Owner/Admin service account for Mixpanel, not a browser project token.

**New events only** is the default. **Include retained events from the last 90 days** sends only this repository's selected event types when adding a destination. Later edits never resend history.

Configured destinations stay editable. Saved credentials remain hidden: leave a field blank to keep its value, or enter a replacement. Saved static custom-header values are also hidden; their redacted placeholders retain the value for the same header name.

| Action | Result |
| --- | --- |
| Save configuration | Saves settings; **Configured** does not prove delivery to reports |
| Cancel | Discards only a new-destination draft |
| Pause / Resume | Stops / restarts sends without saving pending edits |
| Disconnect | Immediately deletes the destination, credentials, and deliveries without saving pending edits; retained events remain |

**Needs attention** flags failed sends without exposing provider responses or delivery statistics. Hub sends no synthetic test events.

## Custom HTTP destinations

For a provider that accepts JSON over HTTPS, add **Custom HTTP**, name the destination, and enter a public URL such as `https://events.example.com/collect?version=1`. Hub sends one POST per selected event. The optional query is visible configuration for nonsecret settings such as a version; credential-like query keys and secret placeholders are rejected. Put credentials in named encrypted secrets, not the URL. A secret can be the complete value of an `Authorization` header, including its scheme:

```json
{"Authorization":{"$secret":"api_token"},"X-Channel":"replica"}
```

Add a named secret `api_token` with a value such as `Bearer <your token>`. The `Headers` editor accepts a JSON object of printable static values or whole-value `{"$secret":"name"}` references. Hub encrypts both saved static header values and secrets. It never returns their saved values to the browser. Header names such as `Host`, `Cookie`, proxy and hop-by-hop headers, and Hub's `X-Replica-Event-Id` header cannot be changed. A blank saved secret value retains that secret on edit; removing its named row removes it.

The body is a JSON template. A literal value stays literal. To insert one approved fact, replace the **whole JSON value** with `{"$field":"event_name"}`; string interpolation, expressions, scripts, and model fields are not supported. For example:

```json
{
  "event": {"$field":"event_name"},
  "id": {"$field":"event_id"},
  "properties": {"$field":"properties"},
  "actor": {"$field":"actor_id","when_missing":null}
}
```

Template version 1 allows `event_id` (stable UUID), `event_name`, `occurred_at` (ISO 8601 UTC timestamp), `repository_id`, optional opaque `actor_id`, optional `prototype_id`, `build_id`, `thread_id`, and `comment_id`, and `properties` (only the applicable scoped IDs). An optional field must declare a scalar `when_missing` fallback, including `null` if appropriate. A whole-value `{"$secret":"name"}` also works in the JSON body. Invalid or missing references fail configuration instead of silently dropping part of a request. The template is bounded in depth and size, and Hub does not add extra body fields: providers with strict schemas may omit the `event_id` body field and still receive the UUID in `X-Replica-Event-Id` on every attempt.

By default, any 2xx response means the endpoint accepted the request. For a provider that returns JSON confirmation, configure one JSON Pointer such as `/result/accepted` and an expected JSON scalar such as `true`; both 2xx **and** that exact field/value are required. Hub never stores or shows response text. The sample request preview uses made-up identifiers and redacted secrets; it sends no network request.

Changing the URL or body template cancels unsent old-revision deliveries. Changing credentials or authentication headers also cancels pending work by default. Select **Same recipient; keep pending events** only when rotating named secrets or the value of an `Authorization`, `X-API-Key`, `X-Auth-Token`, or `Api-Key` header for the *same* endpoint and payload: Hub atomically rebinds still-pending/retryable deliveries to the new credentials. Other header names, even ones containing “auth” or “token,” do not qualify. Hub never rebinds a worker already sending; an HTTP request started before the edit may finish with the old credentials. A changed URL, template, response rule, or non-auth header cannot use this choice. To resend retained events after cancellation, disconnect and re-add a destination with the explicit history option; previously accepted events may be sent again.

Delivery is at least once, not exactly once. Hub retries timeouts, rate limits, and server errors with the **same** event UUID, but the receiving provider must implement its own deduplication if necessary. A 2xx response, even with an optional confirmation field, does not prove that an event appears in downstream reports. Hub does not create synthetic test events.

Only public DNS names over HTTPS port 443 are accepted; IP-literal destinations, redirects, environment HTTP proxies, and private/loopback/link-local/metadata IP addresses are blocked. Hub re-resolves every attempt, rejects a hostname if *any* A or AAAA answer is restricted, connects to a validated public IP, and still verifies TLS using the original hostname. Operators can additionally restrict destinations with `REPLICA_ANALYTICS_OUTBOUND_HOSTS`; see [Deployment](deployment.md). Protect the Hub host with network egress policy as defense in depth. An authorized repository admin can intentionally send the approved event fields to any allowed public endpoint, where that service controls its own retention.

## Recorded activity

For example, discovering a branch does not record an event. Adding that branch to the gallery records `prototype_registered` once; storing its first successful Build records `prototype_first_published`. Each later successful Build records `build_published`.

| Event | When recorded |
| --- | --- |
| `prototype_registered` | Branch first added to the gallery |
| `prototype_first_published` | First successful Build stored for a Prototype |
| `build_published` | Later successful Build stored |
| `review_comment_created` | Root review comment created |
| `review_reply_added` | Reply added |
| `review_thread_resolved` | Open thread resolved |
| `review_thread_reopened` | Resolved thread reopened |

Publication does not require gallery registration. Failed Builds and completed workflows alone do not count. Hub tracks no offline work, local editing, or activity inside previews. Local development records the same Hub-observed events.

Events hold a type, timestamp, stable UUID, repository, and applicable Prototype, Build, thread, and comment IDs. They never hold review text, saved targets, branch names, commit SHAs, or profile fields. A source key makes each recorded transition unique. Product state and its event commit together. A migration marks existing successful Builds as previously published without inventing historical events; the Prototype keeps its first-publication timestamp after events expire.

Known authors receive one opaque identifier across this Hub's repositories, including commit authors without a Hub login. Hub does not infer identity from names or emails. Unknown authors have no stored actor. Actor IDs are pseudonymous, not anonymous: a destination can correlate actions across repositories. They use a purpose-specific HMAC key derived from `SECRET_KEY_BASE`. Keep that secret stable and backed up; rotating it changes future IDs but not retained events.

For an event without a known author, Segment uses `system/<event UUID>` as its anonymous ID. Mixpanel uses the same event-specific value as `distinct_id` and sets `actor_type: system`, so the event appears in reports without implying a real person. Known-person Mixpanel events keep the HMAC actor ID and use `actor_type: person`. Repeated deliveries of one event keep the same identity.

## Provider delivery

An administrator can configure one encrypted destination per built-in provider and multiple independently named custom destinations per repository through `Analytics::Destination#configure!`. Segment requires a source write key; Mixpanel requires a service account username, secret, and numeric project ID. Select a provider-supported region and one or more of the seven event types. Credentials are never returned to clients, and provider responses are not stored.

| Provider | Region | Fixed HTTPS endpoint |
| --- | --- | --- |
| Segment | US / EU | `api.segment.io/v1/track` / `events.eu1.segmentapis.com/v1/track` |
| Mixpanel | US / EU / India | `api.mixpanel.com/import` / `api-eu.mixpanel.com/import` / `api-in.mixpanel.com/import` |

Match the region to the source or project, not to the Hub's location. See [Segment regional configuration](https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/http-api#regional-configuration) and [Mixpanel Import API](https://docs.mixpanel.com/reference/import-events).

The providers can use different regions. Segment EU requires Regional Segment access on a Business plan; Mixpanel EU and India require the matching data residency enrollment. Segment warns that an EU source sent to the US endpoint may return no error but never appear in reports.

Configuration starts with **new events only**. Only an explicit `include_retained: true` on `configure!` queues selected events from the last 90 days; it never crosses repositories. Edits can replace nonblank credentials, change selected event types, or pause and resume with `enabled: false/true`. Pausing keeps newly recorded deliveries pending; deselecting an event cancels outstanding deliveries of that type. Disconnecting with `destroy!` deletes credentials and delivery history but keeps neutral events until expiry. An HTTP request already underway cannot be recalled.

Event creation and its delivery rows commit in the same primary-database transaction. Solid Queue runs independently; a failed enqueue leaves durable pending work. An atomic, 15-minute enqueue claim keeps repeated recovery runs from queuing the same delivery while a worker is waiting. Workers clear the claim when they start; if a queued job disappears, recovery can enqueue again after the claim expires. This claim is separate from the five-minute HTTP worker lease and retry due time.

Run the scheduler and workers: `Analytics::Delivery.recover!` queues eligible work and abandoned claims every minute. `Analytics::Event.clear_expired!` deletes expired events and delivery history hourly. Removing a repository from the GitHub App or expiring an event also stops sends before cleanup. To run either operation immediately:

```sh
bin/devcontainer exec bin/rails runner 'Analytics::Delivery.recover!'
bin/devcontainer exec bin/rails runner 'Analytics::Event.clear_expired!'
```

Delivery is at least once, with up to eight attempts and bounded exponential retry for timeouts, rate limits, and server errors. Each retry keeps the same event UUID (`messageId` or `$insert_id`). Mixpanel imports one event with `strict=1`; a successful response means provider acceptance, not that an event appeared in a report. Authentication, payload, redirect, oversized-response, and provider rejection errors are terminal. Inspect sanitized `failure_code` and `last_delivered_at` rather than provider response text. Corrected Segment/Mixpanel settings apply to future or retryable work; terminal failures require disconnect and explicit retained-event backfill, which can resend previously accepted events. Custom destinations use the revision rules above instead of silently forwarding old work to a new recipient.

Backups and provider copies have separate retention policies; see [Backups](backups-and-restore.md). Store Rails encryption keys and `SECRET_KEY_BASE` in deployment secrets.
