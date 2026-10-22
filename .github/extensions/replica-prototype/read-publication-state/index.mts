import type { CanvasContext } from "../create-canvas-context/index.mjs"
import type { PublishTarget } from "../publish-target/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
import { readState } from "../read-state/index.mjs"

export type PublishMode = "committed-only" | "commit-changes"
export type PublishOutcome = "blocked" | "canceled" | "failed"
export type PublishRequest = Record<string, unknown> & {
  state: "idle" | "requested" | "failed"
  requestedAt: string | null
  error?: string | null
  target?: PublishTarget | null
  mode?: PublishMode
  commitSha?: string | null
  outcome?: PublishOutcome
  reportedAt?: string
}
type PublicationStats = Record<string, unknown> & {
  refreshedAt: string | null
  commitSha: string | null
  workflow: Record<string, unknown> & {
    state: string
    detail: string | null
    run: Record<string, unknown> | null
  }
  remoteBranch?: Record<string, unknown> & { state: string }
}
export type PublicationState = Record<string, unknown> & {
  publishRequest: PublishRequest
  stats: PublicationStats
  updatedAt: string
}

// Preserve unrelated stored fields and legacy requests without a target or mode.
export async function readPublicationState(context: CanvasContext): Promise<PublicationState> {
  const value = await readState(context)
  if (!isPublicationState(value))
    throw new Error("Stored Replica prototype publication state has an unsupported format.")
  return value
}

function isPublicationState(value: unknown): value is PublicationState {
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

function isPublishTarget(value: unknown): value is PublishTarget {
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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function isCommitShaOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[0-9a-f]{40}$/.test(value))
}

function nullableText(value: unknown) {
  return value === null || typeof value === "string"
}
