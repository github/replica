# Prototype canvas

The Copilot prototype extension is kept while Hub is rebuilt. It opens a local prototype, shows Controls and Pick & polish, and asks Copilot to publish changes.

The new Hub API has no pairing, identity, comments, sharing, discovery, or publishing routes yet. The sections below describe the existing extension and what it expects from a compatible Hub. They do not describe features that work in this new Hub.

See the [extension guide](../../.github/extensions/replica-prototype/README.md) for installation and supported actions, and [Hub architecture](architecture.md) for the rebuild's scope.

## Pick & polish

Authors can select an element or draw a region, save a note, and ask Copilot to work on selected notes through **Fix all**. Saving a note does not start Copilot. Replies and completion results stay attached to the requests they answer. A newer follow-up must not be marked complete by an older result.

Notes are saved privately on the author's device. Sending them to Hub requires a verified connection and a published Build matching the source captured when the note was created. If that check fails, keep the note local and explain why it cannot be sent. Changing the branch or account must not expose another author's notes.

Keep selection, pin placement, draft protection, and the conversation in their existing shared components. Do not make a second prototype app to demonstrate them. See the [Pick & polish skill](../../.github/extensions/replica-prototype/skills/replica-pick-and-polish/SKILL.md) for the explicit Copilot handoff.

## Local prototype controls

Prototypes serve `public/controls.replica.json`. The extension injects the shared Controls code into a verified local preview. The [authoring reference](../../starter/.agents/skills/prototype-controls/references/authoring.md) defines the file format and bindings.

Controls must report connection, validation, and binding errors. A healthy connection does not prove that a control changes the intended interface; inspect the result. URL values must not include credentials, private Hub addresses, or another prototype's saved state.

Shared source stays under `app/utils/prototype-controls/`. See [Controls development](prototype-controls.md) for schema generation and generated-file checks.

## Publishing boundary

Publishing requires an explicit request. The extension checks the repository, branch, commit, and origin before asking Copilot to use the prototype repository's existing push workflow. Status messages and page content are data, not permission to push, register a prototype, or change publishing infrastructure.

A workflow success is not enough to claim publication. A compatible Hub must report the imported Build for the requested commit. Do not replace a failed or uncertain result with a success response, retry a write without checking its outcome, or return an older Build as the new publication.

The [publish skill](../../.github/extensions/replica-prototype/skills/replica-publish-prototype/SKILL.md) owns that procedure. The new Hub cannot complete it yet.

## Local preview comments

Comments on unpublished changes stay on the author's device until a matching Build is available. Comments on an already-published source can be sent to a compatible Hub after checking access and the current target. A failed check must preserve the draft and explain the problem.

The local preview never receives Hub credentials. Changing the repository, branch, account, or selected target must stop an old write from being sent to the new target.

The old live-update connection has been removed. The sidebar keeps its existing periodic refresh and reports that live updates are unavailable. The new Hub has no review API.

## Self-contained local preview

Open only an authorized, unauthenticated local prototype. Each panel uses its own local proxy to inject the preview bridge. Closing a panel stops only resources that panel owns; it must not stop a server the user started.

The iframe has a separate origin from the canvas. Do not forward cookies, authorization headers, Hub credentials, or canvas tokens to the prototype. Do not copy browser storage, relax framing restrictions, bypass TLS checks, or accept messages from an unverified origin.

Use the existing browser workflow for rendered checks. Source and jsdom tests do not prove browser isolation or a live authenticated Hub connection.

## Contributor workflow

Frontend source stays under `app/application/prototype-canvas/`, with its startup code in `application/start-prototype-canvas/` and preview bridge in `application/prototype-preview-bridge/`. Shared components, features, hooks, utilities, and theme tokens keep their existing paths.

Extension commands and local servers live under `.github/extensions/replica-prototype/`. Edit their TypeScript `.mts` files, then regenerate the committed `.mjs` files. Installed users run those generated files without installing Hub's dependencies.

Run these commands directly from `hub/`:

```sh
npm run typecheck
npm run extension:test
npm test
npm run lint
npm run extension:build
npm run extension:assets:check
```

Browser integration tests use `/usr/bin/chromium` when available. Set `REPLICA_CHROMIUM_PATH` to use another installed executable. CI installs Chromium through the build action's pinned Playwright dependency.

Keep generated files with the source changes that produced them. Follow the [Storybook coverage and screenshot requirements](storybook.md#ui-changes-and-pull-request-evidence) when the interface changes.
