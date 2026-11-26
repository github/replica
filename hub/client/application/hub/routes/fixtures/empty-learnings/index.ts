import type { LearningsResponse } from "@application/hub/learnings-contracts/types"

export function emptyLearnings(
  administerHub = false,
): Extract<LearningsResponse, { accessDenied: false }> {
  return {
    accessDenied: false,
    repository: { id: "2001", nameWithOwner: "github/prototype", defaultBranch: "main" },
    capabilities: { administerHub, administerRepository: true },
    permissions: { viewEvidence: true, decide: true, requestRun: true, share: false },
    copilot: { state: "connected", connectedBy: "octocat" },
    automaticRunsEnabled: false,
    usageCredits: "0",
    runAvailable: true,
    loadError: null,
    identityReviewCount: 0,
    suggestions: [],
    learnings: [],
    rejected: [],
    shared: [],
    recall: { text: "", count: 0 },
    runs: [],
    activity: [],
    today: "2026-12-22",
  }
}
