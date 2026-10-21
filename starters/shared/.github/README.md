# Repository MCP setup

Use the browser canvas first for agent-driven rendered checks, interaction tests,
screenshots and reviews. This configuration supplies fallback capability, not
a reason to start a second browser when the canvas can perform the check.

[`mcp.json`](mcp.json) pins the official [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) server for this prototype repository. It uses local stdio via `npx -y`, keeps the browser profile in memory with `--isolated`, and disables page-defined tools with `--no-webmcp`. It does not configure a remote endpoint, persistent profile, or shared authenticated browser.

Use npm/npx and an existing Node.js installation matching `engines.node` in [package.json](../package.json). Review and trust the repository MCP configuration in the client, then start a fresh agent session in the copied repository so it can discover the server and its current tool schemas. Initial startup may download the pinned npm package. Do not copy this configuration into global settings or replace other configured MCP servers.

If discovery fails, report the actual error and check client support for repository `.github/mcp.json`, trust approval, the session's checkout, Node/npx, registry access, and package release-age policy. Do not bypass that policy or silently change the pin. If a browser executable is missing, report it and request approval for the necessary installation; setup does not authorize installing browser engines automatically.

Plain/fresh `/setup-skills` reuses the app's built-in browser. Its tooling agent
leaves this configuration unchanged unless a concrete required check has an
evidenced capability gap. Only then may it adapt this entry to the harness's
supported project-local configuration, preserving other servers and this shipped
configuration. A permitted repository-local CLI is considered only for that gap
when the harness lacks project-local MCP support. Installations require separate
approval; the agent records a short usage/status section in `AGENTS.md`.

Playwright is a fallback for authorized rendered route and interaction checks only when the canvas is unavailable for the required check, not a replacement for the visible preview. Follow the browser-selection, recovery, isolation, authentication, and evidence rules in [shared Replica instructions](../REPLICA-AGENTS.md#browser-validation-and-playwright-fallback). MCP startup and tool discovery alone do not prove browser launch, app readiness, or authenticated Build validation. Context researchers may inspect configuration but do not launch servers or browsers; the separate tooling phase can check discovery within its approval boundaries without opening a browser.

Automated suites, CI and build-artifact capture retain their configured drivers;
they run without the Copilot canvas host.
