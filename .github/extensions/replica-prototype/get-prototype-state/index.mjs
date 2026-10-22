import { readRepositoryStats } from "../read-repository-stats/index.mjs"
import { readState } from "../read-state/index.mjs"
import { writeState } from "../write-state/index.mjs"
import { runCommand } from "../run-command/index.mjs"
import {
  capturePublishTarget,
  continuesPublishTarget,
  sameCheckout,
  samePublishTarget,
} from "../publish-target/index.mjs"

const refreshes = new Map()

export async function getPrototypeState(context, { refresh = false } = {}) {
  if (refreshes.has(context.stateFile)) return refreshes.get(context.stateFile)
  const pending = readCurrentState(context, refresh)
  refreshes.set(context.stateFile, pending)
  try {
    return await pending
  } finally {
    refreshes.delete(context.stateFile)
  }
}

async function readCurrentState(context, refresh) {
  let state = await readState(context)
  const age = Date.now() - Date.parse(state.stats.refreshedAt)
  if (!refresh) {
    if (!Number.isFinite(age)) return presentState(context, state)
    const head = await runCommand("git", ["rev-parse", "HEAD"], context.repositoryPath)
    if (age < 60_000 && head.ok && head.stdout.trim() === state.stats.commitSha)
      return presentState(context, state)
  }

  const stats = await readRepositoryStats(context)
  state = await readState(context)
  state.stats = stats
  await synchronizePublishRequest(context, state)
  state.updatedAt = new Date().toISOString()
  await writeState(context, state)

  return presentState(context, state)
}

function presentState(context, state) {
  return {
    stateId: context.stateId,
    prototypeUrl: context.normalizedUrl,
    name: context.name,
    sessionId: context.sessionId,
    publishRequest: state.publishRequest,
    publishStatus: resolvePublishStatus(state),
    stats: state.stats,
    updatedAt: state.updatedAt,
  }
}

function resolvePublishStatus(state) {
  const workflow = state.stats.workflow
  if (state.publishRequest.state === "requested") {
    return {
      state: "requested",
      detail: "Copilot has the request and will continue in chat.",
    }
  }
  if (state.publishRequest.state === "failed") {
    return {
      state: "failed",
      detail: state.publishRequest.error || "The publish request failed.",
    }
  }

  return workflow
}

async function synchronizePublishRequest(context, state) {
  if (state.publishRequest.state === "requested") {
    const currentTarget = await capturePublishTarget(context)
    if (currentTarget.commitSha !== state.stats.commitSha)
      throw new Error("The checkout changed while refreshing publication status. Refresh again.")
    const continuing = state.publishRequest.target
      ? state.publishRequest.mode === "committed-only"
        ? samePublishTarget(state.publishRequest.target, currentTarget)
        : await continuesPublishTarget(context, state.publishRequest.target, currentTarget)
      : state.publishRequest.commitSha === currentTarget.commitSha
    if (!continuing) {
      state.publishRequest.state = "failed"
      state.publishRequest.error =
        "The publication target changed. Check Copilot chat and retry on the intended checkout."
      return
    }
    state.publishRequest.commitSha = currentTarget.commitSha
    if (Date.now() - Date.parse(state.publishRequest.requestedAt) >= 10 * 60_000) {
      state.publishRequest.state = "failed"
      state.publishRequest.error =
        "No completed push was observed. Check Copilot chat and retry when ready."
      return
    } else if (!observedNewPush(state)) {
      return
    }
  }
  if (
    state.publishRequest.state === "failed" &&
    (!state.publishRequest.target ||
      sameCheckout(state.publishRequest.target, await capturePublishTarget(context))) &&
    observedNewPush(state)
  ) {
    // A later push of the current HEAD supersedes the failed request; its workflow and Build
    // evidence now describe publication.
    delete state.publishRequest.outcome
    delete state.publishRequest.reportedAt
    state.publishRequest.state = "idle"
    state.publishRequest.error = null
  }
  if (state.publishRequest.state === "requested") {
    state.publishRequest.state = "idle"
    state.publishRequest.error = null
  }
}

function observedNewPush(state) {
  const request = state.publishRequest
  return (
    state.stats.remoteBranch?.state === "present" &&
    state.stats.remoteBranch.remoteSha === state.stats.commitSha &&
    (request.remoteState === "absent" ||
      (request.remoteState === "present" && request.remoteSha !== state.stats.commitSha) ||
      Boolean(
        state.stats.workflow.run?.databaseId &&
        state.stats.workflow.run.databaseId !== request.workflowRunId,
      ))
  )
}
