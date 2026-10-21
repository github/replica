import { getPrototypeState } from "../get-prototype-state/index.mjs"
import {
  capturePublishTarget,
  continuesPublishTarget,
  samePublishTarget,
} from "../publish-target/index.mjs"
import { readState } from "../read-state/index.mjs"
import { writeState } from "../write-state/index.mjs"

export const PUBLISH_RESULT_OUTCOMES = ["blocked", "canceled", "failed"]
export const MAX_PUBLISH_RESULT_REASON_LENGTH = 300

const outcomeMessages = {
  blocked: "Copilot stopped before pushing because publishing was blocked.",
  canceled: "Publishing was canceled before anything was pushed.",
  failed: "Copilot could not publish this checkout.",
}

/**
 * Ends the pending publish request when the agent stops without pushing. Only the
 * request that the same canvas dispatched for the same target can be ended, and
 * observed push evidence always wins over the report.
 */
export async function reportPublishResult(context, { instanceId, outcome, reason, target, mode }) {
  if (!PUBLISH_RESULT_OUTCOMES.includes(outcome))
    throw new Error("Report a blocked, canceled, or failed publish outcome.")
  const safeReason = normalizeReason(reason)
  const message = safeReason
    ? `${outcomeMessages[outcome]} ${safeReason}`
    : outcomeMessages[outcome]

  const request = (await readState(context)).publishRequest
  const currentTarget = await capturePublishTarget(context)
  if (
    !matches(request) ||
    !(mode === "commit-changes"
      ? await continuesPublishTarget(context, request.target, currentTarget)
      : samePublishTarget(request.target, currentTarget))
  )
    throw conflict("No matching publish request is waiting for Copilot. Refresh the canvas status.")
  if (request.state === "failed" && request.outcome === outcome && request.error === message)
    return acknowledge(context, false)
  if (request.state !== "requested")
    throw conflict("No matching publish request is waiting for Copilot. Refresh the canvas status.")

  const refreshed = await getPrototypeState(context, { refresh: true })
  if (refreshed.publishRequest.state === "idle")
    throw conflict(
      "A push was already observed for this request. Keep following publication with refresh_status.",
    )

  const state = await readState(context)
  if (
    state.publishRequest.requestedAt !== request.requestedAt ||
    state.publishRequest.state !== "requested" ||
    !matches(state.publishRequest)
  )
    throw conflict("The publish request changed while reporting. Refresh the canvas status.")
  const reportedAt = new Date().toISOString()
  state.publishRequest = {
    ...state.publishRequest,
    state: "failed",
    outcome,
    reportedAt,
    error: message,
  }
  state.updatedAt = reportedAt
  await writeState(context, state)
  return acknowledge(context, true)

  function matches(candidate) {
    return (
      typeof instanceId === "string" &&
      candidate.canvasInstanceId === instanceId &&
      target?.canvasInstanceId === instanceId &&
      candidate.mode === mode &&
      target?.mode === mode &&
      Boolean(candidate.target) &&
      samePublishTarget(candidate.target, target ?? {})
    )
  }
}

async function acknowledge(context, reported) {
  const { publishRequest } = await readState(context)
  return {
    reported,
    publishRequest: {
      state: publishRequest.state,
      outcome: publishRequest.outcome,
    },
  }
}

function normalizeReason(value) {
  if (value == null) return ""
  if (typeof value !== "string") throw new Error("The publish result reason must be text.")
  const reason = value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").trim()
  if (reason.length > MAX_PUBLISH_RESULT_REASON_LENGTH)
    throw new Error(
      `Keep the publish result reason under ${MAX_PUBLISH_RESULT_REASON_LENGTH} characters.`,
    )
  return reason
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 })
}
