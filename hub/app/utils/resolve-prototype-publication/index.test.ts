import { describe, expect, it } from "vitest"

import type { PrototypeState } from "../prototype-canvas/types"
import { resolvePublication } from "."
import {
  importedPrototype,
  publicationExamples,
  publicationHub,
  publicationState,
} from "./fixtures"

describe("resolvePublication()", () => {
  it.each([
    ["Loading", "loading"],
    ["Unpublished branch", "unpublished"],
    ["Unpushed changes", "needs_push"],
    ["Awaiting build", "awaiting_build"],
    ["Build queued", "queued"],
    ["Building", "building"],
    ["Build failed", "failed"],
    ["Awaiting Hub import", "importing"],
    ["Automatic publication", "registration"],
    ["Automatic publication failed", "registration"],
    ["Published", "ready"],
    ["Remote check failed", "unknown"],
    ["Detached checkout", "detached"],
    ["Disconnected", "disconnected"],
    ["Expired connection", "disconnected"],
  ])("distinguishes %s", (name, kind) => {
    const example = publicationExamples[name]!
    expect(resolvePublication(example.state, example.hub).kind).toBe(kind)
  })
  it("never treats a different upstream as proof of remote publication", () => {
    const example = publicationExamples["Unpublished branch"]!
    expect(resolvePublication(example.state, example.hub)).toMatchObject({
      kind: "unpublished",
      label: "Publish",
      action: "publish",
    })
  })
  it("shows registration errors without treating a readable prototype as disconnected", () => {
    const example = publicationExamples["Automatic publication failed"]!
    expect(resolvePublication(example.state, example.hub)).toMatchObject({
      kind: "registration",
      action: "none",
      label: "Publication delayed",
      detail: example.hub!.registrationError,
    })
  })
  it.each([
    ["write_access_required", "You lack write access to this repository."],
    ["remote_branch_missing", "The branch no longer exists on the remote repository."],
    ["branch_authorship_required", "You have not authored a commit unique to this branch."],
    [
      "branch_not_reviewable",
      "Default, reserved, and internal branches cannot be registered in Hub.",
    ],
    ["repository_mismatch", "The branch belongs to a different repository."],
  ])("explains the authoritative %s registration reason", (reason, detail) => {
    const example = publicationExamples["Automatic publication"]!
    const publication = resolvePublication(example.state, {
      ...example.hub!,
      prototype: { ...example.hub!.prototype!, canRegister: false, registrationReason: reason },
    })
    expect(publication.error).toEqual({
      title: "Branch not eligible for Hub registration",
      description: detail,
    })
    expect(publication.action).toBe("none")
  })
  it("retains a generic error for an unknown reason without guessing authorship", () => {
    const example = publicationExamples["Unknown registration reason"]!
    expect(resolvePublication(example.state, example.hub).error).toEqual({
      title: "Hub registration failed",
      description:
        "Hub could not register this branch. Check repository access and branch eligibility.",
    })
  })
  it.each([
    [
      "already_registered",
      "Branch already registered in Hub",
      "This branch is already registered in Hub. Refresh its status.",
    ],
    [
      "successful_build_required",
      "Hub registration delayed",
      "Hub has not imported this checkout's successful Build yet.",
    ],
  ])("uses an appropriate non-eligibility headline for %s", (reason, title, description) => {
    const example = publicationExamples["Automatic publication"]!
    expect(
      resolvePublication(example.state, {
        ...example.hub!,
        registrationReason: reason,
      }).error,
    ).toEqual({ title, description })
  })
  it("uses only independently verified facts with an older Hub", () => {
    const example = publicationExamples["Write access required"]!
    const hub = {
      ...example.hub!,
      prototype: { ...example.hub!.prototype!, registrationReason: undefined },
    }
    expect(resolvePublication(example.state, hub).error?.description).toBe(
      "You lack write access to this repository.",
    )
    expect(
      resolvePublication(example.state, {
        ...hub,
        prototype: { ...hub.prototype, canEdit: true },
      }).error?.description,
    ).toBe("Hub could not register this branch. Check repository access and branch eligibility.")
    const missing = publicationExamples["Missing remote branch"]!
    const missingPublication = resolvePublication(missing.state, {
      ...missing.hub!,
      prototype: { ...missing.hub!.prototype!, registrationReason: undefined },
    })
    expect(missingPublication.action).toBe("publish")
    expect(missingPublication.error?.description).toBe(
      "The branch no longer exists on the remote repository.",
    )
  })
  it("never mislabels an excluded default branch as a deleted remote branch", () => {
    const example = publicationExamples["Unpublished branch"]!
    const state = {
      ...example.state!,
      stats: {
        ...example.state!.stats,
        branch: "main",
        remoteBranch: { ...example.state!.stats.remoteBranch!, branch: "main" },
      },
    }
    const publication = resolvePublication(state, { ...publicationHub, branch: "main" })
    expect(publication.error?.description).toContain("Default, reserved, and internal branches")
    expect(publication.error?.description).not.toContain("remote repository")
  })
  it("keeps an eligibility error visible during a pending push without changing its action", () => {
    const example = publicationExamples["Missing remote branch"]!
    const publication = resolvePublication(
      {
        ...example.state!,
        publishRequest: {
          state: "requested",
          requestedAt: new Date().toISOString(),
          commitSha: example.state!.stats.commitSha,
          buildNumber: 1,
        },
      },
      example.hub,
    )
    expect(publication.kind).toBe("requested")
    expect(publication.action).toBe("none")
    expect(publication.error?.description).toBe(
      "The branch no longer exists on the remote repository.",
    )
  })
  it("does not reuse a registration reason from a different checkout or generic 403", () => {
    const example = publicationExamples["Write access required"]!
    expect(
      resolvePublication(example.state, { ...example.hub!, branch: "other" }).error,
    ).toBeUndefined()
    const publication = resolvePublication(example.state, {
      ...publicationHub,
      state: "denied",
      message: "Hub returned HTTP 403.",
    })
    expect(publication.error).toEqual({
      title: "Hub verification unavailable",
      description: "Hub returned HTTP 403.",
    })
    expect(publication.error?.description).not.toContain("write access")
  })
  it.each([
    "failure",
    "cancelled",
    "timed_out",
    "action_required",
    "startup_failure",
    "neutral",
    "skipped",
  ])("shows completed %s as unsuccessful", (conclusion) => {
    const example = publicationExamples["Build failed"]!.state!
    expect(
      resolvePublication(
        {
          ...example,
          stats: {
            ...example.stats,
            workflow: {
              ...example.stats.workflow!,
              run: { ...example.stats.workflow!.run!, conclusion },
            },
          },
        },
        publicationHub,
      ),
    ).toMatchObject({
      kind: "failed",
      action: "publish",
      detail: `The Replica workflow finished with ${conclusion}. Pushing this unchanged commit does not rerun the failed work. Inspect the run and repair the cause before publishing again.`,
    })
  })
  it("does not reuse a stale remote, workflow, Hub response or imported commit", () => {
    expect(
      resolvePublication(
        {
          ...publicationState,
          stats: {
            ...publicationState.stats,
            remoteBranch: { ...publicationState.stats.remoteBranch!, branch: "old" },
          },
        },
        publicationHub,
      ).kind,
    ).toBe("unknown")
    const succeeded = publicationExamples["Awaiting Hub import"]!.state!
    expect(
      resolvePublication(
        {
          ...succeeded,
          stats: {
            ...succeeded.stats,
            workflow: {
              ...succeeded.stats.workflow!,
              run: { ...succeeded.stats.workflow!.run!, headBranch: "old" },
            },
          },
        },
        publicationHub,
      ).kind,
    ).toBe("unknown")
    expect(resolvePublication(publicationState, { ...publicationHub, branch: "old" }).kind).toBe(
      "unknown",
    )
    expect(
      resolvePublication(succeeded, {
        ...publicationHub,
        state: "connected",
        prototype: {
          ...importedPrototype,
          build: { ...importedPrototype.build!, commitSha: "b".repeat(40) },
        },
      }).kind,
    ).toBe("importing")
  })
  it("requires registration and respects Hub import failure for the exact commit", () => {
    expect(
      resolvePublication(publicationState, {
        ...publicationHub,
        state: "connected",
        prototype: {
          ...importedPrototype,
          build: null,
          published: false,
          currentBuild: { commitSha: publicationState.stats.commitSha!, state: "failed" },
        },
      }),
    ).toMatchObject({
      kind: "failed",
      detail:
        "Hub could not import or build this commit. Pushing this unchanged commit does not rerun the failed work. Inspect the Build failure in Hub and repair the cause before publishing again.",
    })
  })
  it("describes publication progress without an approval policy", () => {
    const example = publicationExamples["Unpublished branch"]!
    const pending = resolvePublication(
      {
        ...example.state!,
        publishRequest: {
          state: "requested",
          requestedAt: new Date().toISOString(),
          commitSha: publicationState.stats.commitSha,
        },
      },
      example.hub,
    )
    expect(pending.detail).toBe(
      "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
    )

    const unpushed = publicationExamples["Unpushed changes"]!
    const push = resolvePublication(unpushed.state, unpushed.hub)
    expect(push.detail).toContain("Publish pushes this branch without force")

    const failed = publicationExamples["Build failed"]!
    const workflowFailure = resolvePublication(failed.state, failed.hub)
    const importFailure = resolvePublication(publicationState, {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        build: null,
        published: false,
        currentBuild: { commitSha: publicationState.stats.commitSha!, state: "failed" },
      },
    })
    for (const failure of [workflowFailure, importFailure]) {
      expect(failure.detail).toContain("repair the cause before publishing again")
    }
    for (const publication of [pending, push, workflowFailure, importFailure]) {
      expect(publication.detail).not.toMatch(/confirm|approval|approve|authoriz/i)
    }
  })
  it("uses Build numbers instead of comparing Hub and workstation timestamps", () => {
    const published = publicationExamples["Published"]!
    const state = {
      ...published.state!,
      publishRequest: {
        state: "idle",
        requestedAt: "2099-01-01T00:00:00Z",
        commitSha: published.state!.stats.commitSha,
        buildNumber: 0,
      },
    } satisfies PrototypeState
    expect(resolvePublication(state, published.hub)).toMatchObject({
      kind: "ready",
      action: "none",
    })
    const previousBuild = {
      ...state,
      publishRequest: { ...state.publishRequest, buildNumber: 1 },
    }
    expect(resolvePublication(previousBuild, published.hub).kind).not.toBe("ready")
    expect(
      resolvePublication(
        {
          ...previousBuild,
          publishRequest: {
            ...previousBuild.publishRequest,
            state: "requested",
            requestedAt: new Date().toISOString(),
          },
        },
        published.hub,
      ),
    ).toMatchObject({ kind: "awaiting_build", action: "none" })
    expect(
      resolvePublication(
        {
          ...previousBuild,
          publishRequest: {
            ...previousBuild.publishRequest,
            state: "failed",
            error: "Push failed.",
          },
        },
        published.hub,
      ),
    ).toMatchObject({ kind: "failed", detail: "Push failed." })
    expect(
      resolvePublication(
        {
          ...state,
          publishRequest: { ...state.publishRequest, state: "requested", buildNumber: 0 },
        },
        published.hub,
      ).kind,
    ).toBe("ready")
  })
  it("keeps pending dispatch disabled but permits retry after timeout", () => {
    const example = publicationExamples["Unpublished branch"]!
    const state = {
      ...example.state!,
      publishRequest: {
        state: "requested",
        requestedAt: new Date().toISOString(),
        commitSha: publicationState.stats.commitSha,
      },
    } satisfies PrototypeState
    expect(resolvePublication(state, example.hub)).toMatchObject({
      kind: "requested",
      action: "none",
      detail:
        "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
      label: "Waiting for Copilot",
    })
    state.publishRequest.requestedAt = new Date(Date.now() - 11 * 60_000).toISOString()
    expect(resolvePublication(state, example.hub)).toMatchObject({
      kind: "unpublished",
      action: "publish",
    })
  })
  it.each(["Awaiting build", "Build queued", "Building", "Awaiting Hub import"])(
    "advances a pending request to %s once the committed HEAD is on the remote",
    (name) => {
      const example = publicationExamples[name]!
      const state = {
        ...example.state!,
        publishRequest: {
          state: "requested",
          requestedAt: new Date().toISOString(),
          commitSha: example.state!.stats.commitSha,
        },
      } satisfies PrototypeState
      const publication = resolvePublication(state, example.hub)
      expect(publication.kind).toBe(resolvePublication(example.state, example.hub).kind)
      expect(publication.detail).not.toBe(
        "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
      )
    },
  )
  it("shows a pending update to a remote branch as waiting for Copilot", () => {
    const example = publicationExamples["Unpushed changes"]!
    expect(
      resolvePublication(
        {
          ...example.state!,
          publishRequest: {
            state: "requested",
            requestedAt: new Date().toISOString(),
            commitSha: example.state!.stats.commitSha,
          },
        },
        example.hub,
      ),
    ).toMatchObject({ kind: "requested", action: "none", label: "Waiting for Copilot" })
  })
  it.each(["requested", "failed"] as const)(
    "shows publication instead of a stale %s push request",
    (state) => {
      expect(
        resolvePublication(
          {
            ...publicationState,
            publishRequest: {
              state,
              requestedAt: new Date().toISOString(),
              commitSha: publicationState.stats.commitSha,
            },
          },
          publicationExamples.Published!.hub,
        ),
      ).toMatchObject({ kind: "ready", action: "none" })
    },
  )
  it("surfaces workflow, Hub authorization, and configuration errors", () => {
    expect(
      resolvePublication(
        {
          ...publicationState,
          stats: {
            ...publicationState.stats,
            workflow: { state: "unavailable", detail: "HTTP 403" },
          },
        },
        publicationHub,
      ),
    ).toMatchObject({ kind: "unknown", action: "retry" })
    expect(resolvePublication(publicationState, { ...publicationHub, state: "denied" }).kind).toBe(
      "unknown",
    )
    expect(
      resolvePublication(
        { ...publicationState, stats: { ...publicationState.stats, replicaWorkflowExists: false } },
        publicationHub,
      ).kind,
    ).toBe("workflow_missing")
  })
})
