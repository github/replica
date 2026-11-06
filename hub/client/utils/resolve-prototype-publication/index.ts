import type { HubStatus, PrototypeState } from "../prototype-canvas/types"
import { publicationCopy as copy } from "./en"

export type Publication = {
  kind:
    | "loading"
    | "unknown"
    | "detached"
    | "disconnected"
    | "unpublished"
    | "needs_push"
    | "awaiting_build"
    | "queued"
    | "building"
    | "failed"
    | "importing"
    | "registration"
    | "ready"
    | "requested"
    | "workflow_missing"
  detail: string
  label: string
  action: "publish" | "retry" | "none"
  error?: { title: string; description: string }
  runUrl?: string
}

export function resolvePublication(
  state: PrototypeState | null,
  hub: HubStatus | null,
): Publication {
  let registrationError: Publication["error"]
  function result(
    kind: Publication["kind"],
    detail: string,
    label: string,
    action: Publication["action"] = "none",
  ): Publication {
    return {
      kind,
      detail,
      label,
      action,
      ...(registrationError ? { error: registrationError } : {}),
    }
  }
  if (!state) return result("loading", copy.initial, copy.checking)
  const { stats } = state
  const remote = stats.remoteBranch
  if (!remote || remote.state === "loading")
    return result("loading", copy.checkingRemote, copy.checking)
  if (!stats.branch || remote.state === "detached")
    return result("detached", copy.detached, copy.retry, "retry")
  if (
    remote.repository !== stats.repository ||
    remote.branch !== stats.branch ||
    remote.commitSha !== stats.commitSha
  )
    return result("unknown", copy.changed, copy.retry, "retry")
  if (remote.state === "unknown")
    return result("unknown", copy.unknown(remote.error), copy.retry, "retry")
  const prototype = hub?.state === "connected" ? hub.prototype : undefined
  const matchingBuild =
    prototype?.build?.commitSha === stats.commitSha && prototype?.branch === stats.branch
  const pending = state.publishRequest
  const candidate =
    hub?.state === "connected" &&
    hub.repository === stats.repository &&
    hub.branch === stats.branch &&
    (!hub.commitSha || hub.commitSha === stats.commitSha) &&
    hub.prototype?.branch === stats.branch &&
    hub.prototype.build?.commitSha === stats.commitSha
      ? hub.prototype.build
      : null
  const freshBuild = Boolean(
    candidate &&
    (pending?.commitSha !== stats.commitSha ||
      pending.buildNumber === undefined ||
      (typeof pending.buildNumber === "number" && candidate.number > pending.buildNumber)),
  )
  const publishedBuild = freshBuild && prototype?.registered && prototype.published
  const matchesHubCheckout =
    hub !== null &&
    hub.repository === stats.repository &&
    (!hub.branch || hub.branch === stats.branch) &&
    (!hub.commitSha || hub.commitSha === stats.commitSha)
  if (
    hub &&
    matchesHubCheckout &&
    (hub.state === "connected" || hub.state === "undiscovered") &&
    !prototype?.registered &&
    (!prototype || prototype.branch === stats.branch)
  ) {
    const reason = hub.registrationReason || prototype?.registrationReason
    const excludedDefault = stats.branch === hub.discovery?.defaultBranch
    if (reason || hub.registrationError || prototype?.canRegister === false || excludedDefault) {
      const verifiedReason =
        reason ||
        (excludedDefault
          ? "branch_not_reviewable"
          : prototype?.canEdit === false
            ? "write_access_required"
            : prototype?.canRegister === false && remote.state === "absent"
              ? "remote_branch_missing"
              : undefined)
      registrationError = (verifiedReason && copy.registrationReasons.get(verifiedReason)) || {
        title: copy.registrationErrorTitle,
        description: hub.registrationError || copy.registrationDenied,
      }
    }
  }
  if (
    pending?.state === "requested" &&
    (!pending.commitSha || pending.commitSha === stats.commitSha) &&
    (remote.state === "absent" || remote.remoteSha !== stats.commitSha) &&
    !freshBuild
  ) {
    const age = Date.now() - Date.parse(pending.requestedAt || "")
    if (Number.isFinite(age) && age < 10 * 60_000)
      return result("requested", copy.pending, copy.awaitingCopilot)
  }
  if (!hub) return result("loading", copy.checkingHub, copy.checking)
  if (hub.state === "disconnected" || hub.state === "pairing" || hub.state === "unconfigured")
    return result("disconnected", hub.message || copy.disconnected, copy.connect)
  if (hub.state === "denied" || hub.state === "unavailable")
    return {
      ...result("unknown", hub.message || copy.hubUnavailable, copy.retry, "retry"),
      error: {
        title: copy.hubUnavailableTitle,
        description: hub.message || copy.hubUnavailable,
      },
    }
  if (!matchesHubCheckout) return result("unknown", copy.staleHub, copy.retry, "retry")
  if (!stats.replicaWorkflowExists)
    return result("workflow_missing", copy.workflowMissing, copy.retry, "retry")
  if (
    pending?.state === "failed" &&
    !publishedBuild &&
    (!pending.commitSha || pending.commitSha === stats.commitSha)
  )
    return result("failed", pending.error || copy.dispatchFailed, copy.retryPublish, "publish")
  if (remote.state === "absent")
    return result("unpublished", copy.absent, copy.publishBranch, "publish")
  if (remote.remoteSha !== stats.commitSha)
    return result("needs_push", copy.needsPush, copy.publishChanges, "publish")
  if (matchingBuild) {
    if (!prototype.registered)
      return result(
        "registration",
        hub.registrationError ||
          (prototype.canEdit && prototype.canRegister
            ? copy.needsRegistration
            : copy.registrationDenied),
        hub.registrationError ? copy.registrationFailed : copy.registration,
      )
    if (prototype.published && freshBuild) return result("ready", copy.ready, copy.published)
  }
  if (
    prototype?.currentBuild?.commitSha === stats.commitSha &&
    prototype.branch === stats.branch &&
    prototype.currentBuild.state === "failed"
  )
    return result("failed", copy.importFailed, copy.retryPublish, "publish")
  const workflow = stats.workflow
  if (!workflow || workflow.state === "unavailable")
    return result("unknown", workflow?.detail || copy.workflowUnavailable, copy.retry, "retry")
  const run = workflow.run
  if (run && (run.headSha !== stats.commitSha || run.headBranch !== stats.branch))
    return result("unknown", copy.staleWorkflow, copy.retry, "retry")
  if (
    pending?.commitSha === stats.commitSha &&
    pending.workflowRunId != null &&
    run?.databaseId === pending.workflowRunId &&
    !freshBuild
  )
    return result("awaiting_build", copy.noBuild, copy.awaitingBuild)
  let publication: Publication
  if (workflow.state === "in_progress" && run) {
    const queued = ["queued", "waiting", "pending", "requested"].includes(run.status || "")
    publication = result(
      queued ? "queued" : "building",
      queued ? copy.workflowQueued : copy.workflowBuilding,
      queued ? copy.queued : copy.building,
    )
  } else if (workflow.state === "failed" && run) {
    publication = result(
      "failed",
      copy.workflowFailed(run.conclusion),
      copy.retryPublish,
      "publish",
    )
  } else if (workflow.state === "succeeded" && run) {
    publication = result("importing", copy.importing, copy.awaitingHub)
  } else {
    publication = result("awaiting_build", copy.noBuild, copy.awaitingBuild)
  }
  if (run?.url?.startsWith("https://github.com/")) publication.runUrl = run.url
  return publication
}
