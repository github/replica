# Browser validation context research template

Own repository- and tool-specific target, readiness, safe state and browser
adapter information. Generic browser selection and execution stay in the
`browser-canvas-validation` skill's shared workflow: canvas first for agent work,
configured Playwright MCP only for unavailable checks, then the narrow CLI path.
Keep one shared target/recovery contract, with CLI differences only where needed.
Use setup's automatic consumer-local research scope, honoring saved opt-outs and
exclusions. Inspect definitions and local docs, never execute discovered commands
or start a preview/browser session during setup.
Optional topics follow the library entrypoint's owner-topic convention. Their
triggers include opening, readiness and validating a healthy preview, not only
browser failures. Keep common authorization and evidence limits in this root.

## Target and readiness

Find the worktree-specific preview/server command if one exists, whether starting
it is authorized, target URL source, base paths/routes, deterministic readiness
assertions and failure signals. Static/offline preview is valid. Do not assume
a server, port, framework or scaffold.

Record the early-preview policy: once the authorized route is known and the
preview is running, show its current state before UI edits and keep it visible.
Prefer the Replica prototype canvas when available; otherwise use an available
browser canvas or supported local browser and disclose the limitation.
Starting a server still requires repository authorization. Distinguish canvas
availability from Hub connection status. Preserve the exact authorized URL,
including deployment base, path, query and hash. A printed URL or HTML response
alone does not prove application bootstrap or route readiness.

## Canvas host and identifiers

Find the intended Copilot host, handle reuse and page-identifier contracts. Record where runtime identifiers come from, not universal fixed IDs. Runtime discovery is authoritative for current schemas and actions. Inspect a schema before the first required operation, then reuse it only for the same provider and session. Rediscover after provider reload/reconnect, a schema mismatch or an explicit request to check changed capabilities; a timeout alone does not invalidate it.

Configuration is not availability. Missing canvas support does not authorize silent substitution.

Keep `canvasId` and `instanceId` distinct. Actions addressed by the panel handle
need no separate page acquisition. Record separate page identifiers only when
the runtime schema requires and supplies them; never derive one from a handle
or another session. Missing required acquisition is a blocker, not an action
failure. Recheck current capabilities instead of preserving stale host limits.

## Configured Playwright MCP fallback

Inspect the consumer's `.github/mcp.json` and `.github/README.md` when present.
The starter pins the official Microsoft Playwright MCP server in `.github/mcp.json`, using local stdio, `--isolated` and `--no-webmcp`.
Record repository trust, fresh-session discovery, Node/npx and browser-engine
prerequisites without claiming installation, launch or tool availability.
Do not launch MCP or a browser during context research.

For authorized checks, record the configured fallback and prerequisites; follow
the shared workflow's affected-check handoff for unavailable canvas runtime,
actions, required identifiers or unreadable inspection after bounded recovery.
Keep supported work in the canvas. Application failures and authentication
walls are not reasons to switch drivers. Discover current MCP schemas at task
time; never freeze tool names, element refs or tab IDs. Keep the visual preview.

## Existing CLI adapter

Find an existing executable or declared script, installed version,
version-matched documentation/help text, supported commands, engine/runtime
prerequisites and configuration precedence. Record only CLI-specific target differences. Identify
snapshot filtering, focus measurement or other capability limits.
Do not run the executable, even for `--help`, to prove availability during setup.
Do not assume a package runner may download missing software. A CLI fallback is
for an explicitly requested CLI-only check or a named capability neither the
canvas nor configured MCP can supply, not a second default workflow or
replacement for deterministic CI.

## Sessions, safe state and artifacts

Find run-owned session selection, permitted existing authentication profile
references or explicit unauthenticated mode, allowed origins and test data.
Store nonsecret references only, never credentials, cookies or saved auth data.
Unknown profile permissions are blockers. Do not assume drivers share sessions.
For the Playwright MCP fallback, require a new agent-owned isolated browser.
Never inherit authentication, copy cookies or storage, read browser profiles,
use CDP or attach to existing tabs. An authentication wall blocks dependent
checks; request authorized user sign-in in the separate isolated browser,
not automated authentication changes or a bypass.
Find authorized artifact destinations, redaction and capture boundaries.
Link product scenario/side-effect policy in [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md).
Unspecified mutations and external submissions are not authorized.

## Measurements and evidence limits

Find actual read-only rendered interaction, theme, resize, overflow, keyboard,
focus, accessibility-tree, contrast, performance and persistence capabilities.
Record what each can establish, applicable states and unavailable measurements.
Link [RESPONSIVE-DESIGN.md](./RESPONSIVE-DESIGN.md) for widths and tasks and
[ACCESSIBILITY.md](./ACCESSIBILITY.md) for manual evidence, not copies of them.
Find optional tooling suppression/restoration rules, without hiding product
content. A snapshot is not a screen-reader test. Source inspection is not
rendered, performance or fidelity evidence.
Distinguish server/tool discovery, actual rendered observations and authenticated
Build verification. MCP observations cannot establish canvas correctness or
what happened in another browser session.

## Recovery and cleanup

Find bounded readiness/recovery commands, required approvals and resource
ownership. Distinguish host registration delays from application failures.
Identify what the run may close without disturbing user-owned sessions.
Link lifecycle policy in [REPOSITORY.md](./REPOSITORY.md). Do not install tools,
repair daemons, create auth or start undeclared infrastructure during validation.

Allow one bounded same-panel recovery attempt: check documented readiness, refocus the same owned instance, and retry inspection once only if required runtime identifiers are available. Reuse the current schema unless its invalidation condition applies. Do not loop or open duplicate panels. A timed-out interaction may already have succeeded; inspect its resulting state before considering another action. Do not restart a healthy server because its canvas timed out. A separate MCP browser starts with a fresh read of the authorized route, not a replay or an assumption of shared state.

If MCP is unavailable, report the actual blocker, repository trust/fresh-session
setup and remaining checks as unverified. Do not silently install browser engines.
Close the owned fallback browser when finished, preserving user-owned previews
and unrelated resources. Keep artifact capture within approved destinations
and privacy boundaries; browser access does not authorize publishing evidence
or mutating Hub/review/publishing state.
