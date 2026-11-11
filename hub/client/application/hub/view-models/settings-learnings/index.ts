import type { LearningsPageData } from "@pages/learnings-page/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { LearningsResponse } from "@application/hub/learnings-contracts/types"

import { repositoryWorkspace } from "../repository-workspace"

function formatCredits(value: string) {
  return `${value} AI ${value === "1" ? "credit" : "credits"}`
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

export function settingsLearnings(
  workspace: WorkspaceResponse,
  state: LearningsResponse,
  search: URLSearchParams,
): LearningsPageData {
  const repository = state.repository
  const repositoryId = state.repository.id
  const currentWorkspace = workspace.capabilities
    ? {
        ...workspace,
        capabilities: {
          ...workspace.capabilities,
          administerHub: state.canAdministerHub,
        },
      }
    : workspace
  const shared = {
    ...repositoryWorkspace(currentWorkspace, repository, search),
    selectedSection: "learnings" as const,
    pageTitle: "Learnings",
    alert: null,
    notice: null,
    accessDeniedLabel: "You do not have permission to view this repository's learnings.",
  }
  if (state.accessDenied) return { ...shared, accessDenied: true }
  const pending = state.runs.find((run) => run.state === "queued" || run.state === "running")
  const statusMessage =
    state.copilot.state === "not-connected"
      ? "Learnings stays off until a Hub administrator connects Copilot."
      : state.copilot.state === "refused"
        ? `Copilot refused Hub's Copilot token${
            state.copilot.refusedAt
              ? ` on ${new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
                  new Date(state.copilot.refusedAt),
                )}`
              : ""
          }, so Hub stopped looking for learnings until the token is replaced or checked again on the Copilot page. You can still decide on suggestions, and agents still get accepted learnings.`
        : `Hub looks for learnings once a day when there are new comments${
            state.copilot.connectedBy
              ? `, using the Copilot connection @${state.copilot.connectedBy} made`
              : ""
          }.`
  return {
    ...shared,
    accessDenied: false,
    canDecide: state.permissions.decide,
    copy: {
      heading: "Learnings",
      description:
        "Hub reads this repository's prototype review comments, asks Copilot which points keep coming up, and suggests learnings. Agents that build prototypes here get the learnings you accept.",
      runLabel: "Find learnings now",
      suggestionsHeading: "Suggestions",
      suggestionsEmpty:
        "No suggestions yet. Hub suggests a learning when at least two reviewers raise the same point on two prototypes.",
      evidenceHeading: "What reviewers said",
      contradictionsHeading: "What reviewers disagreed with",
      replacementHeading: "Accepting this replaces the guidance listed below.",
      deletedComment: "The author deleted this comment.",
      accept: "Accept",
      edit: "Edit and accept",
      contentLabel: "Wording agents get",
      acceptEdited: "Accept with this wording",
      reject: "Reject",
      rejectReason: "Why reject this suggestion?",
      confirmReject: "Reject suggestion",
      cancel: "Cancel",
      acceptedHeading: "Accepted learnings",
      acceptedEmpty: "No accepted learnings yet.",
      retire: "Retire",
      retireReason: "Why retire this learning?",
      confirmRetire: "Retire learning",
      recallHeading: "What an agent gets",
      recallDescription:
        "This preview shows the default learnings within the count and text limits. An agent's task can change their order and which ones fit.",
      recallEmpty: "Agents get nothing yet. Accept a suggestion to share it with agents.",
      runsHeading: "Recent runs",
      runsEmpty: "Hub has not looked for learnings in this repository yet.",
      runColumns: {
        started: "Started",
        startedBy: "Started by",
        result: "Result",
        usage: "Copilot usage",
      },
    },
    status: {
      message: statusMessage,
      refused: state.copilot.state !== "connected",
      activity:
        pending?.state === "running"
          ? "Hub is looking for learnings now."
          : pending
            ? "Hub will look for learnings shortly."
            : null,
      usage: `Copilot used ${formatCredits(state.usageCredits)} for this repository in the last 30 days.`,
    },
    run: {
      path: `/repositories/${repositoryId}/learnings/runs`,
      available: state.permissions.requestRun && state.runAvailable,
    },
    loadError: state.loadError
      ? `Hub could not read this repository's learnings: ${state.loadError}`
      : null,
    identityNotice:
      state.identityReviewCount > 0
        ? "Earlier suggestions or accepted learnings need identity revalidation. Hub keeps their history, but agents cannot use those versions. Find learnings again, then review any rebuilt suggestions."
        : null,
    suggestions: state.suggestions.map((entry) => ({
      id: entry.id,
      content: entry.content,
      digest: entry.reviewDigest,
      decisionPath: `/repositories/${repositoryId}/learnings/${encodeURIComponent(entry.id)}/decision`,
      support: entry.support
        ? `Raised by ${formatCount(entry.support.reviewers, "reviewer")} on ${formatCount(
            entry.support.prototypes,
            "prototype",
          )}`
        : null,
      replaces: entry.replaces.map((target) => ({
        id: target.id,
        content: target.content ?? "This learning's wording is not available for review.",
      })),
      evidence: entry.evidence.map((item) => ({
        ...item,
        prototypePath: `/repositories/${repositoryId}/prototypes/${item.prototypeId}`,
      })),
      otherEvidence:
        entry.otherEvidenceCount > 0
          ? `${formatCount(entry.otherEvidenceCount, "more comment")} that Hub cannot show here`
          : null,
      contradictions: entry.contradictions.map((item) => ({
        ...item,
        prototypePath: `/repositories/${repositoryId}/prototypes/${item.prototypeId}`,
      })),
      otherContradictions:
        entry.otherContradictionsCount > 0
          ? `${formatCount(entry.otherContradictionsCount, "more opposing comment")} that Hub cannot show here`
          : null,
    })),
    learnings: state.learnings.map((entry) => ({
      id: entry.id,
      content:
        entry.content ??
        (entry.status === "damaged"
          ? "This learning's wording is unavailable because its stored record failed integrity checks."
          : entry.status === "identity-review"
            ? "This version's wording is withheld until its reviewer identities are revalidated."
            : "This learning's wording is not available for review."),
      decisionPath: `/repositories/${repositoryId}/learnings/${encodeURIComponent(entry.id)}/decision`,
      accepted:
        entry.acceptedBy && entry.acceptedAt
          ? `Accepted by @${entry.acceptedBy} on ${new Intl.DateTimeFormat("en-US", {
              dateStyle: "long",
            }).format(new Date(entry.acceptedAt))}${entry.edited ? ", with edits" : ""}`
          : null,
      recalled: entry.status === "recalled",
      status:
        entry.status === "recalled"
          ? "This learning is included in the preview below."
          : entry.status === "budget-excluded"
            ? "This learning is eligible, but the preview's count or text limit leaves it out. An agent's task can change which learnings fit."
            : entry.status === "damaged"
              ? "This learning failed the store's integrity checks, so agents do not get it. An operator can run replica-learning verify."
              : entry.status === "identity-review"
                ? "Reviewer identities need revalidation, so agents cannot use this version until its evidence is rebuilt and reviewed."
                : "This learning is eligible, but an agent's task can change its order and whether it fits.",
    })),
    recall: state.recall,
    runs: state.runs.map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      startedBy:
        run.startedBy.type === "daily"
          ? "Daily"
          : run.startedBy.type === "user"
            ? `@${run.startedBy.login}`
            : "Someone",
      state: run.state,
      stateLabel:
        run.state === "succeeded"
          ? "Finished"
          : run.state === "failed"
            ? "Failed"
            : run.state === "running"
              ? "Running"
              : "Waiting",
      result:
        run.result?.type === "failed"
          ? run.result.summary
          : run.result
            ? [
                formatCount(run.result.commentsConsidered, "new comment"),
                ...(run.result.commentsConsidered > 0
                  ? [formatCount(run.result.commentsLabeled, "labeled", "labeled")]
                  : []),
                formatCount(run.result.suggestions, "new suggestion"),
                ...(run.result.commentsRemaining > 0
                  ? [
                      `${formatCount(run.result.commentsRemaining, "comment")} left for the next run`,
                    ]
                  : []),
                ...(run.result.suggestionsRemaining > 0
                  ? [
                      `${formatCount(run.result.suggestionsRemaining, "suggestion")} left for the next run`,
                    ]
                  : []),
              ].join(", ")
            : null,
      usage: run.usage
        ? `${formatCredits(run.usage.credits)} in ${formatCount(run.usage.requests, "request")}`
        : "None",
    })),
  }
}
