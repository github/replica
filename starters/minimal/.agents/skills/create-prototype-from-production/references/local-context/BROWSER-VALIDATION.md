# Browser validation

> Minimal default context. Replace it through `/setup-skills` when your team has its own guidance.

## Target and readiness

Use the URL the development server reports, not a guessed port. Preserve the route, query and hash. A page is ready when fonts have loaded, visible images are complete and the expected content has rendered.

## Canvas host and identifiers

Follow `REPLICA.md` and the shared `browser-canvas-validation` workflow. Discover actual schemas and identifiers; never invent them.

## Sessions, safe state and artifacts

Use a fresh, agent-owned isolated browser session. Never inherit authentication, copy cookies or storage, or attach to the user's tabs.

## Measurements and evidence limits

Check rendering, navigation and relevant interactions at the viewports in [RESPONSIVE-DESIGN.md](./RESPONSIVE-DESIGN.md). Report unavailable checks as unverified.

## Recovery and cleanup

Inspect the resulting state before retrying a timed-out action. Do not restart a healthy server. Close only resources you opened.
