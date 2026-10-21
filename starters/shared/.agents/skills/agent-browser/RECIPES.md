# CLI prerequisites and recipes

## Existing runtime only

The external driver is [agent-browser](https://github.com/vercel-labs/agent-browser),
also distributed as the npm package `agent-browser` and native installations.
The toolkit bundles no executable, browser engine, daemon, dependency or auth.
An npm-based installation needs its declared Node runtime, while other installs
may use a native binary. The selected installed version determines prerequisites.
It also needs an already available compatible browser engine and platform
libraries, or an explicitly authorized existing browser connection.

Use the repository's exact installed executable or package script. Check its
version/help without opening a page, then load its version-matched reference.
Bare `npx agent-browser` can install a package, so do not use it as discovery or
an automatic fallback. Do not run `install`, upgrade, dependency installation,
login, profile creation or state import/export to make a review work.

Identify configuration precedence from the installed reference, including
repository/config flags and environment overrides. Context stores only command
and profile references, never cookies, storage state, tokens or credentials.
Do not dump environment variables or global auth files to discover settings.
Reject an unexpected remote provider or destination. Use only the declared
authorized profile, or an explicitly unauthenticated run-owned session.

## Command shapes

These examples illustrate command shapes, not a required pinned version or evidence of browser availability. Replace placeholders from approved context and verify every command and flag against the installed command reference. Apply any declared nonsecret profile/config selection consistently, not just to the first command.

```sh
agent-browser --version
agent-browser --help
agent-browser skills get core
agent-browser --session <run-owned-session> open "<authorized-url>"
agent-browser --session <run-owned-session> snapshot -i
agent-browser --session <run-owned-session> set viewport <width> <height>
agent-browser --session <run-owned-session> snapshot -i
agent-browser --session <run-owned-session> press Tab
agent-browser --session <run-owned-session> snapshot --json
agent-browser --session <run-owned-session> close
```

These are shapes, not a script to execute all at once. Confirm target and
deterministic readiness after opening and state changes, using the installed
wait/assertion commands supported by the adapter. Network idle alone may never
occur or may precede application readiness.

## Evidence recipes

For a viewport sweep, use each product `RESPONSIVE-DESIGN.md` dimension and state,
observe actual rendered size, and record required task access and overflow.
Use repository-declared diagnostics, not fixed widths, overflow rules or
screenshot flags from another application.

For keyboard focus, begin from a known state and press Tab/Shift+Tab or the
widget's documented keys. Record actual focused element, name, sequence and
escape/restoration. An interactive snapshot alone does not identify current
focus or prove focus-ring visibility. Use an exposed focus diagnostic and
visual evidence where needed, otherwise mark those assertions untested.

For an accessibility tree, capture the installed driver's supported snapshot
form and record its filtering/depth limitations. Do not call an interactive-only
or pruned snapshot a full tree. Inspect roles, names and states relevant to the
requested check. No tree output proves screen-reader announcements or usability.

Capture screenshots only when needed for an assertion and when the adapter
allows the destination and content. Keep artifacts run-owned and redact
sensitive content. Do not upload evidence without authorization.

## Failure and cleanup

After a missing/stale ref, take a fresh snapshot, do not reuse canvas refs.
After a timed-out action inspect current state before any retry that might
duplicate an effect. A missing browser or connection failure is a blocker, not
permission to repair the installation.

Do not automatically run `doctor`: some versions clean daemon files, contact
networks or launch a browser even without a repair flag. Diagnose only through
version-documented read-only operations allowed by the repository.
Never run repair flags as part of validation.

Close only sessions this run opened, using their exact session identifiers.
Never use a global close-all command or close a user-owned attached browser.
If cleanup fails report the remaining run-owned resource rather than killing
unrelated processes or deleting shared state.

## Adaptation provenance

Adapted from `github/prototyping` commit
`9027d375f6033d4a334d84ae12987685cbac884f`,
`.github/skills/agent-browser/{SKILL.md,RECIPES.md}` and repository browser
contracts. Source server paths, profile assumptions, screenshot dependency,
network-idle default and automatic doctor invocation were not imported.
The external driver's code is not vendored. Its own license governs its install.
