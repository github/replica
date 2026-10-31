# Security rate limits

Hub limits expensive requests before changing data or calling GitHub for a workflow installation. For example, a person may make 60 comment changes in one minute across their repositories, browser Sessions, and canvas connections. The next change returns HTTP 429 without writing the comment. Reading conversations, polling, and marking threads read do not spend that allowance.

These fixed budgets are product policy, not measured capacity or configurable deployment settings. Existing public-share, pairing, renewal, and operator-enrollment limits remain in place.

| Feature | Allowance | Counted identity |
| --- | --- | --- |
| GitHub App setup authorization, including rejected secrets | 5 per minute | Trusted source IP |
| GitHub OAuth initiation, including enrollment and fresh verification | 60 per 5 minutes | Trusted source IP |
| GitHub OAuth callback | 60 per 5 minutes, separately from initiation | Trusted source IP |
| Comment creation, replies, edits, deletion, reactions, and resolution | 60 per minute | Hub user |
| Analytics destination creation, edits, pause, resume, and disconnect | 5 per minute | Hub user |
| Workflow installation or update requests | 5 per 10 minutes | Hub user |
| Hub administrator mutations | 10 per minute | Hub user |
| Learning recalls for agents | 30 per minute | Canvas connection |
| New supported, signature-verified webhook processing | 600 per minute | Entire Hub |

Budgets counted per Hub user span repositories and credentials. Features have separate counters. Repository permission, CSRF, administrator role, fresh authorization, and webhook signature checks are not replaced by a quota. Rejected authorization and fresh analytics challenges cannot write. A request's quota admission is not proof of permission or successful processing.

## Counting and retry guidance

The request path uses Rails's rate limiter with one explicit feature scope. Production stores its atomic counters in the existing Solid Cache database. Independent workers must share that database and its persistent storage; separate cache files do not form a shared Hub budget. A counter window begins on its first request. Later increments retain that expiry. Cache increment failures raise instead of falling through Rails's nil-counter admission behavior.

IP budgets use the same trusted-proxy boundary as the [security audit](security-audit.md). Hub uses the socket peer unless Rails's configured trusted proxies include it. The HTTPS edge must replace untrusted forwarding metadata with a verified client chain, and backend ingress and proxy trust must match the intended forwarders. Local socket tests do not establish deployed TLS or proxy enforcement.

Setup authorization attempts share their IP allowance across browser Sessions. Opening the setup page and continuing an authorized setup through its callback and installation do not spend this allowance. A throttled attempt cannot authorize setup, even with the correct bootstrap secret. Keep using a long, generated bootstrap secret; throttling does not replace secret strength.

Fresh-verification POST requests spend the existing initiation allowance before challenge lookup, including unknown or deleted targets. Passive reads do not spend it. Local HTTP 429 responses remain in ordinary request logs only; they never write security-audit records.

HTTP 429 includes `Retry-After`, private/no-store caching, and localized retry guidance. The delay is conservatively the full window in seconds, not a claim about the precise remaining lifetime. JSON responses include `code: "rate_limited"`, `errors`, and `retryAfter`. Browser forms show the explanation; review UI retains data and drafts and shows it in an alert. Canvas actions generate their own retry wording from the validated delay instead of forwarding server prose. Canvas review shows guidance even with the Hub sidebar closed. Neither surface automatically retries a rejected mutation.

## Administrator integration

`ApplicationController` applies the budget after browser authentication, and only when the live GitHub-backed user still has the persisted Hub-admin role. `SecurityRateLimiting::ADMIN_MUTATIONS` names role updates, sharing-setting updates, all-session revocation, App reset, credential updates, webhook rotation, and connecting or disconnecting Copilot. These exact server-resolved controller/action pairs do not load peer controllers or infer permission from request paths. Their normal authorization, confirmations, fresh proof, and transactional role checks remain authoritative. [Combined controller tests](../test/integration/combined_security_test.rb) exercise their common budget and ordinary-user denials through the real routes, not only the registry.

An independently developed administrator controller needs no missing concern or copied limiter. Keep its ordinary guard, and register each mutation in this shared registry when integrating it. Reads are not registered. A new administrator operation must add its exact server-owned action here and prove the shared-user budget; an unregistered action has no implied coverage.

## Webhook admission

Hub preserves the 25 MB body cap and verifies the signature before reading supported event metadata. Invalid signatures, unsupported events, another App or installation, and missing configuration cannot spend the verified allowance or create trusted local recovery work.

Each GUID retains immutable event and body-digest identity. Successfully processed identical deliveries do not spend another allowance, even after quota exhaustion. A throttled or unfinished GUID must obtain admission when it next starts actual processing. Processing leases serialize overlapping duplicates; a stale request cannot clear or complete a newer lease. Throttling leaves the receipt unfinished and stores only recovery metadata, never its body.

## Automatic GitHub redelivery

GitHub does **not** promise automatic retries or honor Hub's `Retry-After`. Solid Queue runs recovery every minute. Hub authenticates with its existing App JWT, verifies the current App identity, and reads `/app/hook/deliveries`. It requests a resend through `/app/hook/deliveries/:numeric_id/attempts`; GitHub's numeric attempt ID changes between attempts, while the delivery GUID stays constant.

Recovery includes known verified throttles and supported transient HTTP 429, 5xx, or transport failures reported by the current App's authenticated API. Unknown remote metadata is only a pending resend request, not a verified receipt. Authentication failures, unsupported events, completed GUIDs, replaced App work, and stale repository-installation work are excluded. Every resend must pass the ordinary inbound signature, supported-event, immutable identity, and Hub quota gates.

GitHub retains recoverable deliveries for [three days](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks). Hub uses the earliest known delivery time, not each retry's arrival time. Recovery walks opaque, validated same-origin cursors with at most 100 entries per page, 10 pages and 30 resend requests per job. A scan stops visibly after 5,000 pages rather than making unlimited requests. Persisted cursor, queue claim, due time, and worker leases recover queue rejection, partial API failures, and worker restarts without a retry storm. GitHub I/O runs outside database transactions.

Initial scans and credential re-verification walk the full available history. Ordinary scans follow GitHub's documented date boundary and stop only after a whole page predates the previous completed scan's start. Mixed pages are processed in full. Saving the start, rather than the finish, lets the next scan find deliveries that arrived while earlier pages were being read.

Recovered pushes follow the [Build discovery guard](build-discovery.md#discovery-rules): GitHub must still report that commit at the branch head, with no later local head observation during the lookup. Ordinary live pushes do not make this extra GitHub request. Recovered installation creation must fetch its current GitHub status before changing the installed owner state; an old removed installation cannot replace its active successor. Hub only processes webhook events and retries failed deliveries for the installation ID entered during manual setup. Events and delivery records for other installations of the same App are ignored.

Changing credentials for the same App preserves pending recovery, but stops dispatch using its old credential revision. The next scheduler tick clears the old scan cursor, queue claim, and worker leases and starts a current-App-authenticated scan. Each retained delivery waits with `credentials_changed` until that scan observes its exact GUID and matching event and installation. Only then can it use the new credentials. Neither re-verification nor repeated credential changes extend the original earliest-delivery deadline, reset consumed attempts, or shorten backoff. Unobserved deliveries cannot resend and expire visibly at the original three-day cutoff.

A paused metadata response or stale worker cannot save or complete work after losing its credential revision or lease. Reset, deletion, or a replaced local App configuration fails the old backlog rather than transferring it, even if a newly configured App has the same remote ID. Normal signature verification and repository synchronization still gate any returned delivery.

Each GUID has at most 12 outbound attempts with exponential backoff capped at one hour. API acceptance means waiting for a signed inbound success, not success itself. Failed requests and exhausted attempts remain explicit. Concurrent or stale workers cannot overwrite a completed receipt.

## Operations and retention

Inspect recovery without contacting GitHub:

```sh
bin/devcontainer exec bin/rails replica:github:webhook_recovery
```

The report shows actual scan completion and conservative coverage through that scan's start. It also shows consecutive scan failures, retained pending/failed counts, failure codes, and any known gap outside GitHub's window. The scheduler records window expiry and longer gaps in the global security audit. Logs contain server-owned record IDs and fixed failure categories, not webhook payloads, secrets, or external response bodies.

Receipts retain GUID and digest deduplication for seven days. Terminal recovery metadata remains for 30 days. Minute ticks expire unresolved recovery windows; separate hourly cleanup deletes old history in indexed batches with short writes. Audit retention remains the separate [90-day policy](security-audit.md#retention-and-operations), whose Security acceptance is pending.

Operators must monitor unresolved failures. Recovery is bounded, not unlimited or lossless: outages longer than three days, revoked credentials, exhausted attempts, sustained backlog beyond the scan bound, and a stopped scheduler can leave unrecoverable historical gaps. Repository polling supplements recovery with current state; it cannot reconstruct every historical event. See GitHub's [failed-delivery guidance](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) and [automatic App redelivery example](https://docs.github.com/en/webhooks/using-webhooks/automatically-redelivering-failed-deliveries-for-a-github-app-webhook).
