---
name: create-prototype-from-production
description: 'Use when asked to copy, clone, replicate or recreate a live production website or web app as a Replica prototype from its URL, such as "create a prototype from https://example.com" or "replicate this site for a demo". Do not use for building a new design from a brief, or for changing an existing prototype.'
---

# Create prototype from production

Turn a public production URL into a standalone, connected prototype in this
repository: every first-level destination built or explicitly stubbed, with a
coverage ledger and an honest difference report.

**The prototype is a standalone Vite app.** Replica canvas, Hub and setup
workflows are optional layers. Nothing in this skill waits on them.

## Intake: one batched question, then work

Ask once, in a single `ask_user` call (two questions). If the user is
unavailable (autopilot, headless or no answer), apply the defaults and record
them in the handoff: first-level coverage, and **yes** to the go-ahead. The
go-ahead covers only local, git-reversible actions in this repository, so an
unattended run still activates its generated context and finishes the build.
Never push, publish or touch other repositories without an explicit answer.

1. **Coverage.** Default: every first-level destination, meaning every link in
   the home page, header (including opened menus), mobile menu and footer.
   Alternatives: named sections only, or full sitemap.
2. **Go-ahead** for this repository: install locked dependencies if missing,
   run the local preview, write capture-derived context into `.agents/context/`
   as active guidance, and make focused local commits. No push or publish.

Everything else is a stated default, never a question: use the site's real
public assets and copy for a private demo; preserve its language; disable
real submissions; keep external sites as outbound links; stop at login,
OTP and CAPTCHA walls.

## Phases

| Phase    | Read                                | Exit condition                                                                                 |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Discover | [discover](./workflows/discover.md) | Ledger lists every in-scope destination with a decision                                        |
| Capture  | [capture](./workflows/capture.md)   | Each family has a representative capture; every built page has content                         |
| Build    | [build](./workflows/build.md)       | `node .agents/skills/create-prototype-from-production/scripts/check-ledger.mjs --final` passes |

Load each workflow when its phase starts. Report the current phase in every
progress update.

## Context is produced here, not a prerequisite

Missing `.agents/context/` does **not** block capture or building. Capturing
the public reference needs no approved context. The capture phase writes the
context documents that `create-prototype` and `browser-canvas-validation`
read, and the intake go-ahead is their explicit activation. Do not run
`setup-skills` for this task unless the user asks for team-wide guidance.

## Red flags: stop and correct

| Thought                                                       | Reality                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "Approved context is missing, so screenshots stay uncaptured" | Capture writes the context. Capture first.                                     |
| "Step 1: run setup-skills"                                    | Not for this task. The capture phase produces context.                         |
| "Fetch got 403, use web search / indexed pages"               | Use the isolated browser for that origin. Search results are not the site.     |
| "Raw HTML is enough to find the links"                        | Menus and mobile navigation render at runtime. Discover in the browser.        |
| "The MCP is configured isolated, so captures are isolated"    | Prove it at runtime before the first visit (discover workflow).                |
| "I'll list my open questions for later"                       | Two intake questions only. Everything else has a default.                      |
| "Capture every page in full at both widths"                   | Full captures for family representatives only. Members get content extraction. |
| "Canvas is not in my tool list, so it is missing"             | Run the canvas capability lookup before concluding anything.                   |
| "No answer, so I can't treat it as approval"                  | Unanswered means the defaults, including yes to the local go-ahead.            |
| "Capture every filter option / every FAQ open"                | One screenshot per kind of state, at most 8 per representative.                |
| "Each page looks a bit different, so it is its own family"    | Compare section types in order. More families than half the pages is too fine. |
