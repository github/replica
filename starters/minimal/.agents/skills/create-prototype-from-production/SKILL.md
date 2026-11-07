---
name: create-prototype-from-production
description: 'Use when asked to copy, clone, replicate or recreate a live production website or web app as a Replica prototype from its URL, such as "create a prototype from https://example.com" or "replicate this site for a demo". Do not use for building a new design from a brief, or for changing an existing prototype.'
---

# Create prototype from production

Turn a public production URL into a standalone, connected prototype in this
repository: every first-level destination built or explicitly stubbed, with a
coverage ledger and an honest difference report.

**The prototype is a standalone Vite app.** Hub is optional. Use the Replica canvas when available; explicitly authorized unattended local runs have the [shared preflight's local-preview exception](../../../REPLICA.md#canvas-preflight).

## Intake and unattended runs

Resolve scope and permission from the original request and prior answers. An explicit request for an unattended local run authorizes the local work listed below, subject to any exclusions in that request. Headless execution, autopilot and silence do not grant permission.

In unattended execution, never call a blocking question tool. Use the stated defaults for routine choices and record them in the handoff. Defer any operation requiring permission not already granted, continue independent authorized work, and report the limitation instead of waiting for an answer.

For attended runs, ask only unanswered intake questions before opening the site, in one batch when supported:

1. **Coverage.** Default: every first-level destination, meaning every link in the home page, header (including opened menus), mobile menu and footer. Alternatives: named sections only, or full sitemap.
2. **Go-ahead** for this repository: install locked dependencies if missing, run the local preview, build the prototype, and make focused local commits. Fresh context follows the app's scoped rules below. No push or publish.

Everything else is a stated default, never a question: use the site's real public assets and copy for a private demo; preserve its language; disable real submissions; keep external sites as outbound links; stop at login, OTP and CAPTCHA walls; keep assets of 25 MiB or less at original size, and serve a copy under 25 MiB for larger ones unless the request explicitly chooses otherwise.

This workflow never signs in, submits real data, pushes, publishes, changes other repositories or performs destructive actions. Those require a separate task and explicit authorization.

When authorized, commit at the end of Capture and again at the end of Build. If a commit cannot be made, report the failure and preserve the work; do not claim it was committed.

## Phases

| Phase    | Read                                | Exit condition                                                                                 |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Discover | [discover](./workflows/discover.md) | Ledger lists every in-scope destination with a decision                                        |
| Capture  | [capture](./workflows/capture.md)   | Each family has a representative capture; every built page has content                         |
| Build    | [build](./workflows/build.md)       | `node .agents/skills/create-prototype-from-production/scripts/check-ledger.mjs --final` passes |

Load each workflow when its phase starts. Report the current phase in every
progress update.

## Context is produced here, not a prerequisite

Capturing the public reference needs no approved product context. Follow the [app's context rules](../../../AGENTS.md#product-guidance): an explicitly authorized unattended local run may create fresh capture-derived context when neither active root exists.

Preserve existing context, including `.github/contexts/`; do not overwrite it or create a higher-priority root to shadow it. Keep new observations under `reference/` and use existing guidance for Build. Required changes to existing guidance remain drafts pending reviewed approval; defer affected work without a blocking prompt in unattended runs. Do not run `setup-skills` merely to capture the reference.

## Red flags: stop and correct

| Thought                                                       | Reality                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "Approved context is missing, so screenshots stay uncaptured" | Capture first; fresh unattended context follows the app's scoped exception.    |
| "Step 1: run setup-skills"                                    | Not for this task. The capture phase produces context.                         |
| "Fetch got 403, use web search / indexed pages"               | Use the isolated browser for that origin. Search results are not the site.     |
| "Raw HTML is enough to find the links"                        | Menus and mobile navigation render at runtime. Discover in the browser.        |
| "The MCP is configured isolated, so captures are isolated"    | Prove it at runtime before the first visit (discover workflow).                |
| "Ask about every minor choice"                               | Use stated defaults; unattended runs never issue blocking questions.           |
| "Capture every page in full at both widths"                   | Full captures for family representatives only. Members get content extraction. |
| "The canvas preflight always stops local work"                | Explicitly authorized unattended runs have a narrow local-preview exception.   |
| "Canvas is not in my tool list, so it is missing"             | Run the canvas capability lookup before concluding anything.                   |
| "Headless means I have permission"                           | Honor explicit authorization, not execution mode or silence.                   |
| "Capture every filter option / every FAQ open"                | One screenshot per kind of state, at most 8 per representative.                |
| "Each page looks a bit different, so it is its own family"    | Compare section types in order. More families than half the pages is too fine. |
| "Inner layouts are simplified; I'll note it in differences"   | A representative missing a section, layout or image is a defect. Fix it first. |
| "One generic renderer can serve every family"                 | One composition per family, passing the representative gate.                   |
| "This file is huge; stop to ask"                              | Keep originals to 25 MiB; larger served copies default to under 25 MiB.        |
