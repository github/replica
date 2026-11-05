# Installer terminal design

This guide records the reusable Replica terminal patterns implemented in the Hub deployment wizard. These are working guideposts, not a frozen framework. Revisit them when a real terminal, accessibility requirement, or second consumer exposes a better design.

**Status: implemented locally.** Full-screen and inline layouts, reactive field feedback, resumable drafts, progress, startup ASCII art, and elapsed time use the existing Ink stack. The [installation guide](../README.md) describes operator behavior and recovery. Local terminal exercises use offline sample data; they do not prove an authenticated Azure deployment.

## User and scope

The user is an operator configuring and deploying Hub from a local terminal. They need to understand the current question, notice problems, see progress, and recover their answers after an interruption.

The wizard may save validated, non-secret choices locally. It may change cloud resources only through the existing authorization, ownership, Terraform, and release safeguards. A saved session is not permission to deploy.

Keep the first implementation in `infrastructure/installer/`, above the cloud-specific directories. Reuse its interaction patterns across questions and providers. Extract a shared package only when another real consumer needs it.

This work does not add AWS deployment, arbitrary backward navigation, automatic cloud rollback, a general workflow engine, or a new command-output disclosure policy. It does not authorize an Azure deployment.

## Accepted requirements

| Feedback              | Required outcome                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Startup welcome       | Show fun ASCII art on each interactive launch when space permits, without adding an unnecessary confirmation step.           |
| Terminal ownership    | Use the available terminal space rather than appending an expanding conversation to the shell.                               |
| Subway-style progress | Show a subtle indication of completed, current, and upcoming wizard stages.                                                  |
| Draft recovery        | Detect an unfinished session after restart and offer to resume it.                                                           |
| Distinct messages     | Make errors and warnings visibly different from light-gray operational logs.                                                 |
| Field feedback        | Put validation feedback next to its input, guide users before submission where possible, and keep corrections on that field. |
| Elapsed time          | Show a quiet elapsed-time counter without competing with the task.                                                           |

## Implementation

[`terminal/`](../installer/terminal/index.tsx) owns the asynchronous interaction bridge and renderer lifecycle. Its stable shell separates questions, notices, bounded activity, progress, and elapsed time. Only the active input remounts when a question changes.

[`prompt-for-field/`](../installer/prompt-for-field/index.ts) supplies shared field definitions to the terminal. The field component renders editing guidance and adjacent errors; the same strict parsers guard submission, configuration, and restored answers.

[`session/`](../installer/session/index.ts) stores validated answers and phase checkpoints separately from complete configuration. [`wizard/`](../installer/wizard/index.ts) connects recovery, questions, checkpoints, and orchestration. Complete configuration is still saved before provisioning.

Extend these Ink, Ink UI, parser, and persistence patterns rather than replacing them with a second UI or state-management library.

## Design patterns

### A stable terminal shell

Use the installed Ink renderer's `alternateScreen` option for interactive terminals. This gives the application a separate screen and restores the original shell contents on exit; it does not erase the user's scrollback.

Keep the shell mounted while questions change. Reset only the input component that needs a fresh cursor or selection. The header, progress, notices, and clock must not reset when a question resolves.

Give each area a clear responsibility:

| Area            | Responsibility                                                                               |
| --------------- | -------------------------------------------------------------------------------------------- |
| Header          | Product name and current installation context. Show welcome art here until the first answer. |
| Progress        | One compact row of wizard stages, with the current stage emphasized.                         |
| Main panel      | Current question or operation, contextual help, and adjacent validation feedback.            |
| Notices         | Persistent warnings or failures requiring attention, separate from ordinary logs.            |
| Recent activity | A bounded, low-emphasis view of safe operational messages.                                   |
| Footer          | Relevant keyboard help and a tertiary elapsed-time counter.                                  |

Measure terminal rows and columns and respond to resizing. Reduce decoration and activity history before sacrificing the active input, its error, or required approval text. On narrow screens, replace the full map with the current stage and position. Start in inline mode when the terminal is limited; during a full-screen resize, reduce the surrounding layout and keep the main content reachable with Page Up and Page Down.

Provide an inline fallback for limited terminals and screen-reader use, with an explicit `--no-fullscreen` escape hatch. Preserve the existing requirement for complete configuration and explicit approval in non-interactive mode. Piped output must not contain a full-screen interface, animated clock, or terminal-control sequences.

Own cleanup in one entry-point lifecycle boundary. On cancellation and catchable failures, request command cancellation through the existing abort controller. Stop timers, finish owned-command cleanup, unmount the renderer, and await terminal restoration before printing the final result or recovery summary to the normal shell. Include the draft path and retained-lock guidance when relevant. Do not rely on teardown-time Ink output surviving alternate-screen exit.

Hard termination or power loss cannot guarantee terminal cleanup. Recovery must rely on previously saved checkpoints, not an exit handler successfully running.

### Semantic presentation, not colored log strings

Define a small set of presentation roles: heading, body, muted, accent, success, warning, and error. Centralize their styling in the existing theme. Do not scatter ANSI escapes or color choices through Azure and Terraform code.

Operational logs are light gray or the terminal's equivalent muted style. Warnings use an undimmed warning style; errors use undimmed red. Prefix them with meaningful text such as `Warning:` and `Error:` so color is not the only signal. Respect terminals without color.

Separate three kinds of information:

- Field help and validation belong to the active field.
- Notices describe a condition requiring attention and remain visible until it is resolved or explicitly acknowledged where safe.
- Logs record ordinary activity and may leave the bounded recent-activity area.

A field error must never disappear because six newer log lines arrived. A failed operation must not become an ordinary log line just because the next status message was emitted.

Keep severity separate from recovery behavior. A validation error allows editing; a read-only discovery failure may allow retry; an ambiguous migration or ownership failure requires review. Red text must not imply that the application always exits, and a generic retry button must not repeat unsafe operations.

### A reusable field contract

Extend the existing field definitions with the information the renderer needs: a stable field identifier, label, help, optional example, strict parser, and any useful editing-time guidance. Keep cloud-specific rules outside the presentation components.

Use the same strict parser for submitted answers, saved configuration, and restored draft values. Add editing guidance to the field definition only when needed; do not copy business rules into React components.

The field component should:

- Show constraints and examples before an error occurs.
- Use Ink UI's existing `onChange` support to update guidance while typing.
- Avoid marking untouched fields or obviously incomplete prefixes as failures. For example, a short installation name can show its minimum-length guidance while the user is still typing.
- Show decisive problems, such as forbidden characters or exceeding a limit, immediately.
- Place a concise error directly below the input when submission fails, retain focus, and prevent advancement until the strict parser accepts the answer.
- Clear or update stale errors as the value changes. Do not silently truncate, rewrite, or drop pasted characters to manufacture a valid answer.

Keep read-only remote checks separate from local syntax validation. Do not call Azure on every keystroke. Run a remote check at a deliberate boundary and show its pending state and result next to the relevant interaction.

Preserve the current sensitive-input rule: rejected credential-bearing registry URLs must not be copied into help, notices, logs, or drafts. Clear the rejected registry attempt on submission as today. Drafts contain committed, validated answers, not raw keystrokes or search queries.

### A separate draft-session contract

Keep the reusable deployment configuration and the unfinished wizard session separate. Do not make the deployment schema accept arbitrary partial objects.

Use a versioned companion draft beside the selected configuration, derived from its absolute path, such as `<config path>.draft.json`. Different `--config` targets must not share a draft. Continue to keep real default files under ignored `.local/`.

The draft contains only:

- Its schema version, session identifier, and creation/update timestamps.
- The associated configuration path and supported cloud.
- Explicitly allowed, validated answers, including decisions to skip optional questions.
- The last question or phase and whether configuration or deployment was interrupted.

Never serialize the UI state wholesale. Do not store credentials, access tokens, command output, raw errors, Terraform plans or state, secret-bearing environment variables, or consent for deployment and other cloud changes.

Save after each accepted answer and meaningful phase transition. Await the checkpoint before moving forward. Use private files, exclusive temporary-file creation, and same-directory atomic replacement, following the existing configuration writer. Serialize writes so an older asynchronous save cannot replace a newer answer. Keep one active writer per configuration; atomic replacement alone does not prevent concurrent sessions from overwriting each other.

If saving fails, show a distinct notice and allow the operator to repair the local problem and retry. Keep the previous good draft and in-memory answers. Do not silently claim that progress is saved or start the next cloud-changing operation.

At startup, offer `Resume setup`, `Start over`, and `Exit` when a compatible unfinished draft exists. Show its safe target summary and last-save time. Reject a draft associated with another configuration path rather than rebinding the session. Starting over requires confirmation and discards only the local draft; it does not delete cloud resources or break leases. Preserve an unreadable or unsupported draft and explain the problem rather than silently deleting it.

On resume, revalidate saved answers and requery sign-in, tenants, subscriptions, and region choices before relying on them. If a parent choice becomes invalid or changes, invalidate its dependent choices and derived defaults. Keep independent answers where safe. Do not silently switch to another tenant or subscription. Preserve the existing saved-installation target and owner restrictions: lost access to a committed installation requires restored access or a different configuration path, not retargeting the existing installation.

For questionnaire interruptions, return to the first unresolved question after revalidation. For deployment interruptions, restore configuration and show a recovery review; do not jump directly to the recorded command. Run the existing reconciliation and approval flow, and preserve its refusal to proceed when leases or database provisioning state require operator review.

The draft's progress marker is a hint for the interface, never evidence that a cloud operation succeeded. A local writer lock is not an Azure installation or release lease. Recovering a stale local writer must never clear a cloud lease.

Keep the draft through deployment and failure. Remove it only after the selected flow completes successfully: saved configuration for `--configure-only`, or verified readiness and successful installation-lock release for deployment. Retain the completed deployment configuration for future runs. Non-interactive execution must neither consume a draft nor inherit its choices or consent.

### Explicit, honest progress

Use stable phase identifiers emitted by orchestration, not text matching against status messages. The terminal maps those identifiers to labels and presentation. Azure and Terraform code must not import React or terminal styling.

The top-level deployment route is:

`Cloud -> Checks -> Configure -> Review -> Provision -> Release -> Verify`

Keep detailed operations, such as image publication or temporary database-access cleanup, in the main panel and recent activity rather than adding a station for every command.

Distinguish pending, current, completed, skipped, and blocked states. Advance only after the relevant operation actually returns successfully. Do not invent percentages or mark an operation complete because its command started. Use the actual path for configuration-only runs and existing-installation updates; stages not requested or not needed must not appear successful.

After resume, distinguish restored answers from operations verified in this run. An interrupted deployment requires a warning and recovery acknowledgement before returning to configuration checks. Only the existing deployment engine can establish resource state; the saved phase cannot skip reconciliation.

### Welcome and time

Show a small, original ASCII Replica wordmark and friendly welcome above the first question on every full-screen launch, including existing installations and draft recovery. Enable it before offering recovery choices, not after reading or changing the draft. The terminal dismisses it when the first question resolves. Keep the existing first action: cloud selection for a new questionnaire or recovery choices for an unfinished session. Avoid animation or a separate "press Enter to begin" screen.

Inline mode and screen-reader use keep a compact header without art. Full-screen terminals smaller than 60 columns by 24 rows also omit the art. Keep the product name and instructions.

Use one monotonic elapsed timer for the current process. Start it when the interactive wizard opens, include time waiting for the operator, and display it quietly in the footer. Update once per second, without remounting inputs, moving focus, adding log lines, or creating screen-reader announcements each tick.

For this first version, the timer restarts when the process restarts. The resume prompt separately shows when the draft was saved. Do not present time spent with the application closed as deployment work, or imply a cost estimate or remaining-time prediction.

## Module boundaries

| Boundary                                                  | Owns                                                                                                               | Must not own                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `installer/terminal/` and focused presentation components | Layout, semantic styling, keyboard interaction, field feedback, progress rendering, timer, and terminal lifecycle. | Azure commands, Terraform policy, or persistence decisions.           |
| Existing field definitions and prompt helpers             | Validation, normalization, contextual help, and accepted-answer behavior.                                          | Terminal colors or resource creation.                                 |
| A small `installer/session/` boundary                     | Draft schema, private serialized persistence, writer ownership, and recovery choices.                              | Cloud credentials, deployment approval, or proof of cloud completion. |
| `installer/wizard/`                                       | Connects questions, validated answers, checkpoints, and high-level progress.                                       | Resource-specific deployment logic.                                   |
| `azure/install/` and `terraform/`                         | Discovery, ownership checks, resource reconciliation, approvals, and safe operation order.                         | React components or terminal escape sequences.                        |

Use plain TypeScript contracts and the existing asynchronous UI bridge. Keep one source of truth for accepted answers and explicit phase changes. Do not add a plugin registry, global event bus, state-management dependency, or resource-graph abstraction. Extract small components when a coherent responsibility or real reuse justifies them, not to fill a predetermined folder tree.

## Delivery order

Each phase includes its behavior coverage and documentation update. The final phase is cross-flow acceptance, not the first time the work is tested.

| Phase                             | Complete outcome                                                                                                                                                           | Depends on                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1. Stable shell and message roles | Full-screen and inline modes, persistent layout, semantic notices versus logs, elapsed timer, and reliable terminal restoration.                                           | Existing terminal bridge. |
| 2. Guided fields                  | Shared field descriptors drive help and reactive feedback, errors stay below their input, and valid answers advance without losing earlier choices.                        | Phase 1.                  |
| 3. Durable sessions               | Valid answers checkpoint privately; restart offers resume; invalidated choices, failed saves, active writers, and interrupted deployments have explicit recovery behavior. | Phases 1 and 2.           |
| 4. Welcome and progress           | Startup art stays beside the first question; orchestration supplies an honest stage map for configuration, deployment, updates, and recovery.                              | Phases 1-3.               |
| 5. End-to-end terminal review     | Exercise the complete flows and failure matrix, adjust the visual hierarchy, and document the implemented contracts and remaining gaps.                                    | Phases 1-4.               |

Track substantial follow-up changes using [Contributing](../../CONTRIBUTING.md#before-you-start).

## Acceptance and evidence

Use existing Vitest and Ink testing tools. Follow the [test-writing skill](../../.github/skills/write-tests/SKILL.md) for implementation work. Test public behavior and real temporary-file persistence rather than reproducing the implementation in mocks.

| Area                 | Required evidence                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup              | Each full-screen launch shows the welcome above its first question when space permits, including cloud selection and draft recovery. It disappears after the first answer.                              |
| Fields               | Typing and paste update local feedback; errors stay with their input; invalid Enter does not advance; correction works; registry credentials never enter saved or diagnostic data.                      |
| Drafts               | Restart restores accepted answers; writes are ordered and private; a failed write preserves the previous draft; concurrent writers are refused; corrupt or unsupported drafts are preserved.            |
| Changed targets      | Lost authorization or a changed tenant/subscription invalidates dependent choices without changing independent answers or silently retargeting deployment.                                              |
| Deployment recovery  | A stale phase or prior approval cannot skip checks, replay unsafe SQL or release operations, rotate credentials, or clear retained cloud leases.                                                        |
| Layout and lifecycle | Normal, narrow, and short terminals remain usable; resizing preserves input; success, cancellation, and catchable errors restore the shell and print recovery information outside the alternate screen. |
| Accessibility        | Color-disabled and inline modes retain severity and progress meaning; keyboard actions remain discoverable; the timer does not repeatedly announce or steal focus.                                      |
| Progress and time    | Phases reflect actual outcomes and skipped paths; question changes do not reset the clock; fake-clock checks prove elapsed behavior without slow tests.                                                 |

Use rendered terminal review for color, spacing, hierarchy, and the subtlety of the map and timer. Do not freeze cosmetic ANSI output or exact artwork in broad snapshots. Use isolated sample-data previews for visual checks; these do not prove an authenticated Azure deployment.

## Maintaining the patterns

Keep this document as the rationale and implemented pattern guide. All five delivery phases above are implemented. Label future proposals separately from current behavior and update these contracts as they settle.

Update the [installation guide](../README.md) in the same change that adds a user-visible behavior, including draft location, resume choices, fallback mode, timing semantics, and failure recovery. Keep existing Azure lock and provisioning guidance authoritative rather than duplicating a second recovery procedure here.

Link new components to the established patterns instead of copying their rules into individual agents or prompts. Revisit guideposts when a real terminal, accessibility requirement, or second consumer exposes a better design.
