import { readHubObject } from "../read-hub-object/index.mjs"
import { readState } from "../read-state/index.mjs"
// Preserve unrelated stored fields and legacy requests without a target or mode.
export async function readPublicationState(context) {
  const value = await readState(context)
  if (!isPublicationState(value))
    throw new Error("Stored Replica prototype publication state has an unsupported format.")
  return value
}
function isPublicationState(value) {
  const state = readHubObject(value)
  const request = readHubObject(state?.publishRequest)
  const stats = readHubObject(state?.stats)
  const workflow = readHubObject(stats?.workflow)
  const remoteBranch = readHubObject(stats?.remoteBranch)
  return Boolean(
    state &&
    typeof state.updatedAt === "string" &&
    request &&
    (request.state === "idle" || request.state === "requested" || request.state === "failed") &&
    (request.state === "idle"
      ? request.requestedAt === null || isTimestamp(request.requestedAt)
      : isTimestamp(request.requestedAt)) &&
    (request.error === undefined || nullableText(request.error)) &&
    (request.target == null || isPublishTarget(request.target)) &&
    (request.mode === undefined ||
      request.mode === "committed-only" ||
      request.mode === "commit-changes") &&
    (request.commitSha === undefined || nullableText(request.commitSha)) &&
    (request.outcome === undefined ||
      request.outcome === "blocked" ||
      request.outcome === "canceled" ||
      request.outcome === "failed") &&
    (request.reportedAt === undefined || isTimestamp(request.reportedAt)) &&
    (request.remoteState === undefined || typeof request.remoteState === "string") &&
    (request.remoteSha === undefined || isCommitShaOrNull(request.remoteSha)) &&
    (request.workflowRunId === undefined ||
      request.workflowRunId === null ||
      (typeof request.workflowRunId === "number" &&
        Number.isSafeInteger(request.workflowRunId) &&
        request.workflowRunId > 0)) &&
    stats &&
    (stats.refreshedAt === null || isTimestamp(stats.refreshedAt)) &&
    nullableText(stats.commitSha) &&
    workflow &&
    typeof workflow.state === "string" &&
    nullableText(workflow.detail) &&
    (workflow.run === null || readHubObject(workflow.run)) &&
    (stats.remoteBranch === undefined || (remoteBranch && typeof remoteBranch.state === "string")),
  )
}
function isPublishTarget(value) {
  const target = readHubObject(value)
  return Boolean(
    target &&
    nullableText(target.repository) &&
    typeof target.branch === "string" &&
    typeof target.commitSha === "string" &&
    isCommitShaOrNull(target.commitSha) &&
    nullableText(target.originFingerprint) &&
    nullableText(target.pushFingerprint),
  )
}
function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}
function isCommitShaOrNull(value) {
  return value === null || (typeof value === "string" && /^[0-9a-f]{40}$/.test(value))
}
function nullableText(value) {
  return value === null || typeof value === "string"
}
