import { describe, expect, it } from "vitest"

import { resolvePublication } from "../resolve-prototype-publication"
import {
  importedPrototype,
  publicationExamples,
  publicationHub,
  publicationState,
} from "../resolve-prototype-publication/fixtures"
import type { HubStatus, PrototypeState } from "../prototype-canvas/types"
import { resolveShareReadiness } from "."
import { readinessCopy } from "./en"

function readiness(state: PrototypeState | null, hub: HubStatus | null) {
  return resolveShareReadiness(state, hub, resolvePublication(state, hub))
}

describe("resolveShareReadiness()", () => {
  it.each(["unconfigured", "disconnected", "pairing"] as const)(
    "preserves %s connection recovery when Hub omits checkout metadata",
    (state) => {
      expect(
        readiness(publicationState, { state, repository: publicationState.stats.repository }),
      ).toMatchObject({ kind: "connect", detail: readinessCopy.connectDetail })
      expect(readiness(publicationState, { state })).toMatchObject({
        kind: "connect",
        detail: readinessCopy.connectDetail,
      })
    },
  )

  it.each(["unavailable", "denied"] as const)(
    "preserves the %s verification error when Hub omits checkout metadata",
    (state) => {
      expect(
        readiness(publicationState, { state, message: "Hub verification failed." }),
      ).toMatchObject({ kind: "retry", detail: "Hub verification failed." })
    },
  )

  it.each(["repository", "branch"] as const)(
    "cannot offer sharing or publishing when Hub metadata omits %s",
    (field) => {
      expect(
        readiness(publicationState, {
          ...publicationHub,
          state: "connected",
          [field]: undefined,
          prototype: { ...importedPrototype, canManageShareLinks: true },
        }),
      ).toMatchObject({ kind: "retry", detail: readinessCopy.unavailableDetail })
      expect(
        readiness(publicationExamples["Unpublished branch"]!.state, {
          ...publicationHub,
          [field]: undefined,
        }),
      ).toMatchObject({ kind: "retry", detail: readinessCopy.unavailableDetail })
    },
  )

  it.each([
    { state: "unconfigured" as const, repository: "another/repository" },
    { state: "disconnected" as const, branch: "another-branch" },
  ])("rejects a supplied identity mismatch even with partial metadata", (hub) => {
    expect(readiness(publicationState, hub)).toMatchObject({
      kind: "retry",
      detail: readinessCopy.changedDetail,
    })
  })

  it.each([
    ["Loading", "checking"],
    ["Disconnected", "connect"],
    ["Expired connection", "connect"],
    ["Unpublished branch", "publish"],
    ["Unpushed changes", "publish"],
    ["Build queued", "progress"],
    ["Building", "progress"],
    ["Awaiting Hub import", "progress"],
    ["Automatic publication", "progress"],
    ["Build failed", "publish"],
    ["Hub import failed", "publish"],
    ["Remote check failed", "retry"],
    ["Workflow check failed", "retry"],
    ["Workflow missing", "retry"],
    ["Write access required", "restricted"],
    ["Missing remote branch", "restricted"],
    ["Unknown registration reason", "retry"],
    ["Detached checkout", "restricted"],
  ])("explains %s with %s", (scenario, kind) => {
    const fixture = publicationExamples[scenario]!
    expect(readiness(fixture.state, fixture.hub).kind).toBe(kind)
  })

  it.each(["requested", "in_progress", "failed"] as const)(
    "allows an older published Build despite a newer %s request, local changes and no write permission",
    (requestState) => {
      const state = {
        ...publicationState,
        publishRequest: {
          state: requestState,
          requestedAt: new Date().toISOString(),
          commitSha: publicationState.stats.commitSha,
        },
        stats: { ...publicationState.stats, workingTree: "changed" },
      }
      const hub: HubStatus = {
        ...publicationHub,
        state: "connected",
        prototype: {
          ...importedPrototype,
          canEdit: false,
          canManageShareLinks: true,
          build: { ...importedPrototype.build!, commitSha: "b".repeat(40) },
          currentBuild: { commitSha: publicationState.stats.commitSha!, state: "failed" },
        },
      }
      expect(readiness(state, hub).kind).toBe("ready")
    },
  )

  it.each([false, undefined])(
    "allows internal review without granting public-sharing permission %s",
    (permission) => {
      const result = readiness(publicationState, {
        ...publicationHub,
        state: "connected",
        prototype: { ...importedPrototype, canManageShareLinks: permission },
      })
      expect(result.kind).toBe("ready")
    },
  )

  it.each([false, undefined])(
    "does not offer Publish for undiscovered publishing permission %s",
    (permission) => {
      expect(
        readiness(publicationExamples["Unpublished branch"]!.state, {
          ...publicationHub,
          canPublish: permission,
        }).kind,
      ).toBe(permission === false ? "restricted" : "retry")
    },
  )

  it("requires write access for an unpublished viewer", () => {
    expect(
      readiness(publicationState, {
        ...publicationHub,
        state: "connected",
        prototype: { ...importedPrototype, canEdit: false, published: false, build: null },
      }).kind,
    ).toBe("restricted")
  })

  it.each([undefined, "remote_branch_missing"])(
    "offers explicit publication on an older Hub with registration reason %s",
    (registrationReason) => {
      const state = publicationExamples["Unpublished branch"]!.state!
      const result = readiness(state, {
        ...publicationHub,
        repositoryAuthorized: true,
        canPublish: undefined,
        registrationReason,
      })
      expect(result).toMatchObject({
        kind: "publish",
        title: readinessCopy.publish,
        publication: { action: "publish", label: "Publish" },
      })
      expect(result.detail).toContain(readinessCopy.publishPermissionUnverified)
      expect(result.publication?.error).toBeUndefined()
    },
  )

  it.each(["absent", "present"] as const)(
    "keeps an older Hub's explicit publication in progress with remote branch %s",
    (remoteState) => {
      const state = publicationExamples["Unpublished branch"]!.state!
      expect(
        readiness(
          {
            ...state,
            stats: {
              ...state.stats,
              remoteBranch: {
                ...state.stats.remoteBranch!,
                state: remoteState,
                remoteSha: remoteState === "present" ? state.stats.commitSha : null,
              },
            },
            publishRequest: {
              state: "requested",
              requestedAt: new Date().toISOString(),
              commitSha: state.stats.commitSha,
            },
          },
          { ...publicationHub, repositoryAuthorized: true, canPublish: undefined },
        ).kind,
      ).toBe("progress")
    },
  )

  it.each(["absent", "present", undefined] as const)(
    "uses an idle request as post-push evidence only when it began with remote state %s",
    (remoteState) => {
      const result = readiness(
        {
          ...publicationState,
          publishRequest: {
            state: "idle",
            requestedAt: new Date().toISOString(),
            commitSha: publicationState.stats.commitSha,
            remoteState,
          },
        },
        { ...publicationHub, repositoryAuthorized: true, canPublish: undefined },
      )
      expect(result.kind).toBe(remoteState === "absent" ? "progress" : "retry")
    },
  )

  it.each([
    { repositoryAuthorized: false },
    { canPublish: false },
    { commitSha: "b".repeat(40) },
    { registrationReason: "write_access_required" },
    { registrationReason: "branch_authorship_required" },
    { registrationReason: "unknown_reason" },
  ])("does not infer publishing permission from missing metadata: %j", (metadata) => {
    const result = readiness(publicationExamples["Unpublished branch"]!.state, {
      ...publicationHub,
      canPublish: undefined,
      repositoryAuthorized: true,
      ...metadata,
    })
    expect(["restricted", "retry"]).toContain(result.kind)
    expect(result.publication).toBeUndefined()
  })

  it.each(["Remote check failed", "Workflow missing", "Detached checkout", "Unpushed changes"])(
    "does not offer an older-Hub fallback for %s",
    (scenario) => {
      const result = readiness(publicationExamples[scenario]!.state, {
        ...publicationHub,
        canPublish: undefined,
        repositoryAuthorized: true,
      })
      expect(["restricted", "retry"]).toContain(result.kind)
    },
  )

  it.each([
    { ...publicationHub, state: "unavailable" as const, message: "Hub timed out" },
    { ...publicationHub, state: "denied" as const, message: "Read access was revoked" },
    { ...publicationHub, branch: "another" },
    { ...publicationHub, state: "connected" as const },
    {
      ...publicationHub,
      state: "connected" as const,
      prototype: { ...importedPrototype, build: null },
    },
  ])("keeps unknown Hub metadata out of Publish", (hub) => {
    expect(readiness(publicationState, hub).kind).toBe("retry")
  })

  it("blocks local and default-branch targets", () => {
    expect(
      readiness(publicationState, {
        ...publicationHub,
        discovery: { state: "local" },
      }).kind,
    ).toBe("restricted")
    expect(
      readiness(publicationState, {
        ...publicationHub,
        discovery: { state: "valid", defaultBranch: publicationState.stats.branch },
      }).kind,
    ).toBe("restricted")
  })

  it("shows an initial state error as retry, not endless checking", () => {
    expect(
      resolveShareReadiness(null, null, {
        kind: "unknown",
        action: "retry",
        label: "Retry status",
        detail: "Checkout verification failed",
      }).kind,
    ).toBe("retry")
  })
})
