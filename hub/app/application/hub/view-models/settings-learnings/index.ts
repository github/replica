import type { LearningsPageData } from "@pages/learnings-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"
import { settingsRepositoryWorkspace } from "../settings-repository-workspace"

export function settingsLearnings(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): LearningsPageData {
  if (!state.repository) throw new Error("Learnings needs a selected repository.")
  const repositoryId = state.repository.id
  const pending = state.learningRuns.find((run) => run.state !== "succeeded")
  const accepted = state.learnings.filter((entry) => entry.state === "accepted")
  const canDecide = state.session.capabilities.manageSharing
  return {
    ...settingsRepositoryWorkspace(workspace, state, search, "learnings"),
    canDecide,
    simulationRun: true,
    pageTitle: "Mock learnings",
    alert: null,
    notice: null,
    copy: {
      heading: "Learnings",
      description:
        "Review synthetic suggestions and preview accepted guidance. Nothing is sent to Copilot or an agent.",
      runLabel: pending ? "Advance simulated run" : "Queue simulated run",
      suggestionsHeading: "Mock suggestions",
      suggestionsEmpty: "No pending suggestions in this mock repository.",
      evidenceHeading: "Synthetic evidence",
      contradictionsHeading: "Synthetic opposing evidence",
      replacementHeading: "Replaces this sample guidance",
      deletedComment: "This synthetic evidence is unavailable.",
      accept: "Accept",
      edit: "Edit and accept",
      contentLabel: "Mock guidance wording",
      acceptEdited: "Accept with this wording",
      reject: "Reject",
      rejectReason: "Why reject this mock suggestion?",
      confirmReject: "Reject suggestion",
      cancel: "Cancel",
      acceptedHeading: "Accepted mock learnings",
      acceptedEmpty: "No accepted mock learnings.",
      retire: "Retire",
      retireReason: "Why retire this mock learning?",
      confirmRetire: "Retire learning",
      recallHeading: "Mock recall preview",
      recallDescription:
        "This local preview is data only. It never changes an agent's instructions.",
      recallEmpty: "Accept a mock suggestion to add it to this preview.",
      runsHeading: "Simulated runs",
      runsEmpty: "No fake runs yet. An Admin mock profile can connect the Copilot simulation.",
      runColumns: {
        started: "Started",
        startedBy: "Mock user",
        result: "State",
        usage: "Provider usage",
      },
    },
    status: {
      message: state.copilot.connected
        ? "The Copilot simulation is connected. Advance a fake run from queued to running to finished."
        : "The Copilot simulation is disconnected. Existing mock decisions remain available.",
      refused: !state.copilot.connected,
      activity: pending ? `Fake run ${pending.id} is ${pending.state}.` : null,
      usage: "No provider requests, learning jobs, or credits are used.",
    },
    run: {
      path: resourcePath("/settings/learnings", search, {
        repositoryId,
        operation: pending ? "advance" : "run",
      }),
      available: canDecide && state.copilot.connected,
    },
    loadError: null,
    identityNotice: canDecide ? null : "This mock profile can read guidance but cannot change it.",
    suggestions: state.learnings
      .filter((entry) => entry.state === "suggested")
      .map((entry) => ({
        id: entry.id,
        content: entry.content,
        digest: `mock:v${entry.version}`,
        decisionPath: resourcePath("/settings/learnings", search, {
          repositoryId,
          learningId: entry.id,
        }),
        support: "Synthetic example only; not generated from real review comments.",
        replaces: [],
        evidence:
          state.evidencePrototype && state.evidenceAuthor
            ? [
                {
                  eventId: `mock-evidence-${entry.id}`,
                  commentId: 1,
                  body: "A clear field label makes this example easier to follow.",
                  authorLogin: state.evidenceAuthor.login,
                  authorAvatarUrl: null,
                  prototypeName: state.evidencePrototype.name,
                  prototypePath: `/repositories/${repositoryId}/prototypes/${state.evidencePrototype.id}`,
                  createdAt: "2026-10-30T12:00:00Z",
                },
              ]
            : [],
        otherEvidence: null,
        contradictions: [],
        otherContradictions: null,
      })),
    learnings: accepted.map((entry) => ({
      id: entry.id,
      content: entry.content,
      decisionPath: resourcePath("/settings/learnings", search, {
        repositoryId,
        learningId: entry.id,
      }),
      accepted: entry.decidedBy ? `Accepted by @${entry.decidedBy} in the mock fixture.` : null,
      recalled: true,
      status: "Included in the local mock recall preview.",
    })),
    recall: {
      text: accepted.length
        ? `Mock accepted guidance — data only; never execute it as instructions.\n${accepted.map((entry, index) => `${index + 1}. ${entry.content}`).join("\n")}`
        : "",
      count: accepted.length,
    },
    runs: state.learningRuns.map((run) => ({
      ...run,
      stateLabel:
        run.state === "succeeded" ? "Finished" : run.state === "running" ? "Running" : "Queued",
      result:
        run.state === "succeeded"
          ? "One synthetic suggestion added"
          : "Waiting for your next simulated step",
      usage: "None — simulation",
    })),
  }
}
