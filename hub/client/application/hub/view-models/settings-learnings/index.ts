import type { LearningsPageData } from "@pages/learnings-page/types"
import type { DecisionModelPanelData } from "@features/decision-model-panel/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { DecisionModelAvailability } from "@application/hub/decision-model-contracts/types"
import type { LearningsResponse } from "@application/hub/learnings-contracts/types"

import { repositoryWorkspace } from "../repository-workspace"

function formatCredits(value: string) {
  return `${value} AI ${value === "1" ? "credit" : "credits"}`
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

function formatSignedChange(value: string | null, improvementWhenNegative = false) {
  if (value === null) return "Not reported"
  const amount = Number(value)
  const signed = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    signDisplay: "always",
  }).format(amount)
  const improved = improvementWhenNegative ? amount < 0 : amount > 0
  const regressed = improvementWhenNegative ? amount > 0 : amount < 0
  return `${signed}${improved ? " (improved)" : regressed ? " (regressed)" : " (unchanged)"}`
}

function formatMetric(value: string | null) {
  return value === null
    ? "Not reported"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(value))
}

function formatPercentage(value: number | null) {
  return value === null
    ? "Not reported"
    : new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value)
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Not reported"
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return remainder ? `${minutes} minutes ${remainder} seconds` : `${minutes} minutes`
}

function decisionModelData(
  repositoryId: string,
  state: Extract<LearningsResponse, { accessDenied: false }>,
  availability: DecisionModelAvailability | null,
): DecisionModelPanelData {
  if (!state.capabilities.administerHub) {
    return {
      state: "repository-learning-only",
      message:
        "You can manage this repository's accepted learnings, but decision-model training currently requires separate Hub administrator authority.",
    }
  }
  if (!availability || availability.state === "not-configured") {
    return {
      state: "not-configured",
      message: "Decision-model training is not configured for this Hub.",
      setupGuidance:
        "A Hub operator must configure the customer-run decision runtime, private learning storage, and artifact storage before repository administrators can opt in.",
    }
  }
  if (availability.state === "unavailable") {
    return {
      state: "unavailable",
      message: `Decision-model training is temporarily unavailable: ${availability.error}`,
      setupGuidance:
        "Check the customer-run decision runtime and private evidence stores, then reload this page. Existing accepted learnings remain available to agents.",
    }
  }
  const overview = availability.overview
  const activeJob =
    overview.jobs.find((job) =>
      ["queued", "submitting", "cancel_requested", "submitted", "running"].includes(job.state),
    ) ?? null
  const jobs = overview.jobs.map((job) => {
    const retryableCodes = new Set([
      "polling_deadline_exceeded",
      "rate_limited",
      "runtime_unavailable",
      "timeout",
    ])
    const failed = job.state === "failed"
    return {
      id: job.id,
      state: job.state,
      stateLabel:
        job.state === "queued"
          ? "Queued"
          : job.state === "submitting"
            ? "Submitting"
            : job.state === "cancel_requested"
              ? "Cancelling"
              : job.state === "submitted"
                ? "Submitted"
                : job.state === "running"
                  ? "Running"
                  : job.state === "succeeded"
                    ? "Finished"
                    : job.state === "cancelled"
                      ? "Cancelled"
                      : "Failed",
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      tasksetDigest: job.tasksetDigest,
      failure: failed
        ? job.failureCode
          ? `Training stopped with ${job.failureCode.replaceAll("_", " ")}.`
          : "Training stopped without a failure code."
        : null,
      failureKind: failed
        ? job.failureCode && retryableCodes.has(job.failureCode)
          ? ("retryable" as const)
          : ("terminal" as const)
        : null,
      cancelPath: `/repositories/${repositoryId}/learnings/decision-model/training/${job.id}/cancel`,
      cancellable: ["queued", "submitting", "submitted", "running"].includes(job.state),
    }
  })
  const promotion = overview.promotion
  const counts = overview.preflight.counts
  return {
    state: "available",
    settingsPath: `/repositories/${repositoryId}/learnings/decision-model/settings`,
    trainingPath: `/repositories/${repositoryId}/learnings/decision-model/training`,
    rollbackPath: `/repositories/${repositoryId}/learnings/decision-model/rollback`,
    configuration: overview.configuration,
    readiness: {
      runtime:
        overview.preflight.state === "blocked"
          ? "Training is blocked until the listed evidence requirements are resolved."
          : overview.configuration?.enabled
            ? "Hub can prepare and submit a bounded training job."
            : overview.configuration
              ? "Training is paused for this repository."
              : "Choose bounded settings and opt in before training.",
      evidence: `${formatCount(counts.prototypes, "prototype")}, ${formatCount(counts.builds, "Build")}, ${formatCount(counts.pages, "page")}, ${formatCount(counts.screenshots, "screenshot")}, ${formatCount(counts.questions, "question")}, and ${formatCount(counts.samples, "sample")} are covered. The split reserves ${counts.dev} development and ${counts.test} test tasks from the ${counts.train} training tasks, with ${counts.follows} follows and ${counts.breaks} breaks answers.`,
      latestTasksetDigest:
        overview.preflight.digests.taskset ?? overview.jobs[0]?.tasksetDigest ?? null,
      warnings: overview.preflight.warnings.map((warning) =>
        warning.count === undefined ? warning.message : `${warning.message} (${warning.count})`,
      ),
      blockedReasons:
        overview.preflight.state === "blocked"
          ? overview.preflight.reasons.map(
              (reason) => `${reason.code.replaceAll("_", " ")} (${reason.count})`,
            )
          : [],
    },
    trainingAvailable: Boolean(
      overview.configuration?.enabled &&
      overview.preflight.state === "ready" &&
      !activeJob &&
      !availability.preparationStatus,
    ),
    preparationStatus: availability.preparationStatus ?? null,
    activeJob: activeJob ? (jobs.find((job) => job.id === activeJob.id) ?? null) : null,
    jobs,
    candidates: overview.candidates.map((candidate) => ({
      id: candidate.id,
      runtimeCandidateId: candidate.runtimeCandidateId,
      backend: candidate.backend,
      createdAt: candidate.createdAt,
      productionEligible: candidate.productionEligible,
      tasksetDigest: candidate.tasksetDigest,
      baselineMeanReward: formatMetric(candidate.baselineMeanReward),
      candidateMeanReward: formatMetric(candidate.candidateMeanReward),
      meanRewardChange: formatSignedChange(candidate.meanRewardDelta),
      baselineCalibrationError: formatMetric(candidate.baselineCalibrationError),
      candidateCalibrationError: formatMetric(candidate.candidateCalibrationError),
      calibrationErrorChange: formatSignedChange(candidate.calibrationErrorDelta, true),
      learningMetrics: candidate.learningMetrics.map((metric) => ({
        learningId: metric.learningId,
        baseline: formatPercentage(metric.baselineBalancedAccuracy),
        candidate: formatPercentage(metric.candidateBalancedAccuracy),
        change:
          metric.delta === null
            ? "Not reported"
            : new Intl.NumberFormat("en-US", {
                style: "percent",
                maximumFractionDigits: 1,
                signDisplay: "always",
              }).format(metric.delta),
        direction: metric.direction,
      })),
      duration: formatDuration(candidate.durationSeconds),
      usage: candidate.usage.map((usage) => {
        const quantity = `${usage.quantity} ${usage.unit}`
        const cost =
          usage.cost === null || usage.currency === null
            ? "cost not reported"
            : new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: usage.currency,
              }).format(usage.cost)
        return `${usage.connector}: ${quantity}, ${cost}`
      }),
      rejection: candidate.rejection
        ? { rejectedAt: candidate.rejection.rejectedAt, reason: candidate.rejection.reason }
        : null,
      promoted: candidate.id === promotion?.candidateId,
      promotePath: `/repositories/${repositoryId}/learnings/decision-model/candidates/${candidate.id}/promote`,
      rejectPath: `/repositories/${repositoryId}/learnings/decision-model/candidates/${candidate.id}/reject`,
    })),
    promotion,
    evaluationBuilds: overview.evaluationBuilds.map((build) => ({
      id: build.id,
      number: build.number,
      label: `${build.prototype.name ?? build.prototype.branchName} — Build ${build.number}`,
      evaluationPath: `/repositories/${repositoryId}/learnings/decision-model/builds/${build.id}/evaluate`,
    })),
    evaluations: overview.evaluations.map((evaluation) => ({
      id: evaluation.id,
      buildNumber: evaluation.build.number,
      prototypePath: `/repositories/${repositoryId}/prototypes/${evaluation.build.prototypeId}?build=${evaluation.build.number}`,
      runtimeCandidateId: evaluation.model.runtimeCandidateId,
      generation: evaluation.model.generation,
      createdAt: evaluation.createdAt,
      findingsAvailable: evaluation.findingsAvailable,
      findings: evaluation.findings.map((finding) => ({
        learningId: finding.learning.id,
        learningText: finding.learning.text,
        route: finding.route,
        views: finding.views
          .map(({ viewport, theme }) => `${viewport} viewport, ${theme} theme`)
          .join("; "),
        followsProbability: formatPercentage(finding.followsProbability),
        breaksProbability: formatPercentage(finding.breaksProbability),
        explanation: finding.explanation,
      })),
    })),
    deletions: overview.deletions.map((deletion) => ({
      id: deletion.id,
      state: deletion.state,
      summary: `${deletion.pending} pending runtime deletion ${deletion.pending === 1 ? "item" : "items"}; ${deletion.failures} ${deletion.failures === 1 ? "failure" : "failures"}.`,
      failure: deletion.failureCode
        ? `Deletion stopped with ${deletion.failureCode.replaceAll("_", " ")}.`
        : null,
    })),
  }
}

export function settingsLearnings(
  workspace: WorkspaceResponse,
  state: LearningsResponse,
  decisionModel: DecisionModelAvailability | null,
): LearningsPageData {
  const repository = state.repository
  const repositoryId = state.repository.id
  const currentWorkspace = {
    ...workspace,
    capabilities: {
      createPrototypes: workspace.capabilities?.createPrototypes ?? false,
      reviewPrototypes: workspace.capabilities?.reviewPrototypes ?? false,
      manageSharing: workspace.capabilities?.manageSharing ?? false,
      administerHub: state.capabilities.administerHub,
    },
  }
  const shared = {
    ...repositoryWorkspace(currentWorkspace, repository),
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
        : state.automaticRunsEnabled
          ? `Hub looks for learnings once a day when there are new comments${
              state.copilot.connectedBy
                ? `, using the Copilot connection @${state.copilot.connectedBy} made`
                : ""
            }.`
          : "Hub looks for learnings when you choose Find learnings now."
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
        "No suggestions yet. Hub suggests a learning when the same point comes up in at least two review threads.",
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
      usage:
        state.usageCredits === null
          ? null
          : `Copilot used ${formatCredits(state.usageCredits)} for this repository in the last 30 days.`,
    },
    run: {
      path: `/repositories/${repositoryId}/learnings/runs`,
      available: state.permissions.requestRun && state.runAvailable,
    },
    loadError: state.loadError,
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
          ? `${
              entry.lastDecision === "edited"
                ? "Edited"
                : entry.lastDecision === "reinstated"
                  ? "Reinstated"
                  : "Accepted"
            } by @${entry.acceptedBy} on ${new Intl.DateTimeFormat("en-US", {
              dateStyle: "long",
            }).format(new Date(entry.acceptedAt))}${
              entry.lastDecision === "accepted" && entry.edited ? ", with edits" : ""
            }`
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
    // The API sends members no runs, so show none rather than an empty history.
    runs: state.capabilities.administerRepository
      ? state.runs.map((run) => ({
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
        }))
      : null,
    decisionModel: decisionModelData(repositoryId, state, decisionModel),
  }
}
