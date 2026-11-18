import { describe, expect, it } from "vitest"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { LearningsResponse } from "@application/hub/learnings-contracts/types"

import { settingsLearnings } from "."

const repository = {
  id: "2001",
  nameWithOwner: "github/prototype",
  defaultBranch: "main",
}

const workspace = {
  capabilities: {
    administerHub: true,
    createPrototypes: true,
    manageSharing: true,
    reviewPrototypes: true,
  },
  repositories: [repository],
  viewer: {
    id: "viewer-1",
    login: "mona",
    name: "Mona",
    provider: "github",
  },
} as WorkspaceResponse

describe("settingsLearnings()", () => {
  it("uses repository permissions for learning actions and Hub administration for navigation", () => {
    const state: LearningsResponse = {
      accessDenied: false,
      repository,
      capabilities: { administerHub: false, administerRepository: true },
      permissions: { viewEvidence: true, decide: true, requestRun: true },
      copilot: { state: "connected", connectedBy: null },
      usageCredits: "0",
      runAvailable: true,
      loadError: null,
      identityReviewCount: 0,
      suggestions: [],
      learnings: [],
      recall: { text: "", count: 0 },
      runs: [],
    }

    const result = settingsLearnings(workspace, state, new URLSearchParams())

    expect(result.accessDenied).toBe(false)
    if (result.accessDenied) throw new Error("Expected repository learning access.")
    expect(result.canDecide).toBe(true)
    expect(result.run.available).toBe(true)
    expect(result.administrationLinks).toEqual([])
  })

  it("keeps Hub administration navigation for a denied repository", () => {
    const state: LearningsResponse = {
      accessDenied: true,
      repository,
      capabilities: { administerHub: true, administerRepository: false },
    }

    const result = settingsLearnings(workspace, state, new URLSearchParams())

    expect(result.accessDenied).toBe(true)
    expect(result.administrationLinks).not.toEqual([])
    expect(result).not.toHaveProperty("canDecide")
    expect(result).not.toHaveProperty("run")
  })
})
