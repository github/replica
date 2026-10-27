# CoreAI browser validation

## Target and readiness

Follow the [Replica canvas preflight](../../REPLICA.md#canvas-preflight) before preview startup. Discover the current server and verify it serves CoreAI Sandbox. Use its actual printed URL and authorized route; do not assume the default port identifies this app.

## Browser workflow

Use the [shared browser workflow](../skills/browser-canvas-validation/WORKFLOW.md) and [Replica browser instructions](../../REPLICA-AGENTS.md#browser-validation-and-playwright-fallback) for fresh rendered structure, safe interactions, isolation, bounded recovery and evidence.

Keep the normal prototype preview open. Use the browser canvas first for rendered checks. Only use the configured isolated Playwright fallback for checks blocked by unavailable canvas capability, disclosing the exact blocker. Do not automate authentication, copy credentials or mutate publishing or review state without authorization.

## Verification

Verify the requested route, affected interactions and visible states. A successful HTTP response, dependency install or tool discovery is not rendered evidence. Report blocked or unverified checks explicitly. Stop assistant-owned temporary validation servers and close owned fallback browsers when finished.
