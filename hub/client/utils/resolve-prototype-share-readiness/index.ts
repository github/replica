import type { Publication } from "../resolve-prototype-publication"
import { publicationCopy } from "../resolve-prototype-publication/en"
import type { HubStatus, PrototypeState } from "../prototype-canvas/types"
import { readinessCopy as copy } from "./en"

export type ShareReadiness = {
  kind: "checking" | "connect" | "publish" | "progress" | "ready" | "retry" | "restricted"
  title: string
  detail: string
  publication?: Publication
}

export function resolveShareReadiness(
  state: PrototypeState | null,
  hub: HubStatus | null,
  publication: Publication,
): ShareReadiness {
  function result(kind: ShareReadiness["kind"], title: string, detail: string): ShareReadiness {
    return { kind, title, detail }
  }
  if (!state || !hub)
    return publication.kind === "unknown"
      ? result("retry", copy.unavailable, publication.detail)
      : result("checking", copy.checking, copy.checkingDetail)
  if (!state.stats.branch) return result("restricted", copy.restricted, publication.detail)
  if (
    (hub.repository && hub.repository !== state.stats.repository) ||
    (hub.branch && hub.branch !== state.stats.branch)
  )
    return result("retry", copy.unavailable, copy.changedDetail)
  if (hub.discovery?.state === "local" || state.stats.repository?.startsWith("local/"))
    return result("restricted", copy.restricted, copy.local)
  if (
    hub.registrationReason === "branch_not_reviewable" ||
    state.stats.branch === hub.discovery?.defaultBranch
  )
    return result(
      "restricted",
      copy.restricted,
      publicationCopy.registrationReasons.get("branch_not_reviewable")!.description,
    )
  if (["disconnected", "pairing", "unconfigured"].includes(hub.state))
    return result("connect", copy.connect, copy.connectDetail)
  if (["denied", "unavailable"].includes(hub.state))
    return result("retry", copy.unavailable, hub.message || copy.unavailableDetail)
  if (hub.repository !== state.stats.repository || hub.branch !== state.stats.branch)
    return result("retry", copy.unavailable, copy.unavailableDetail)
  const prototype = hub.prototype
  if (
    hub.state === "connected" &&
    prototype?.branch === state.stats.branch &&
    prototype.registered &&
    prototype.published &&
    prototype.build &&
    Number.isSafeInteger(prototype.build.number) &&
    prototype.build.number > 0
  ) {
    return result("ready", copy.ready, copy.readyDetail)
  }
  if (
    hub.state === "connected" &&
    (!prototype ||
      prototype.branch !== state.stats.branch ||
      typeof prototype.published !== "boolean" ||
      prototype.published)
  )
    return result("retry", copy.unavailable, copy.unavailableDetail)
  const canPublish = hub.state === "connected" ? prototype?.canEdit : hub.canPublish
  if (canPublish === false) return result("restricted", copy.restricted, copy.publishDenied)
  const remote = state.stats.remoteBranch
  const verifiedUnpublishedBranch =
    hub.state === "undiscovered" &&
    hub.repositoryAuthorized === true &&
    !prototype &&
    (!hub.commitSha || hub.commitSha === state.stats.commitSha) &&
    remote?.repository === state.stats.repository &&
    remote?.branch === state.stats.branch &&
    remote?.commitSha === state.stats.commitSha &&
    (remote?.state === "absent" ||
      (remote?.state === "present" &&
        state.publishRequest?.commitSha === state.stats.commitSha &&
        (["requested", "in_progress"].includes(state.publishRequest?.state ?? "") ||
          (state.publishRequest?.state === "idle" &&
            state.publishRequest.remoteState === "absent")))) &&
    !["loading", "unknown", "detached", "workflow_missing"].includes(publication.kind)
  const permissionUnverified = canPublish === undefined && verifiedUnpublishedBranch
  if (canPublish !== true && !permissionUnverified)
    return result("retry", copy.unavailable, copy.permissionUnknown)
  const reason = hub.registrationReason || prototype?.registrationReason
  if (publication.error && (reason !== "remote_branch_missing" || !verifiedUnpublishedBranch)) {
    const recoverable = ["successful_build_required", "already_registered"].includes(reason || "")
    const restricted = [
      "write_access_required",
      "repository_mismatch",
      "branch_not_reviewable",
      "remote_branch_missing",
      "branch_authorship_required",
    ].includes(reason || "")
    return {
      ...result(
        recoverable ? "progress" : restricted ? "restricted" : "retry",
        publication.error.title,
        publication.error.description,
      ),
      ...(recoverable
        ? { publication: { ...publication, action: "retry", label: publicationCopy.retry } }
        : {}),
    }
  }
  if (publication.kind === "detached")
    return result("restricted", copy.restricted, publication.detail)
  if (publication.action === "retry") return result("retry", copy.unavailable, publication.detail)
  if (publication.kind === "loading") return result("checking", copy.checking, publication.detail)
  const detail = permissionUnverified
    ? `${copy.publishDetail} ${copy.publishPermissionUnverified}`
    : copy.publishDetail
  const publishPublication =
    verifiedUnpublishedBranch && reason === "remote_branch_missing"
      ? { ...publication, error: undefined }
      : publication
  if (publication.action === "publish")
    return { ...result("publish", copy.publish, detail), publication: publishPublication }
  return {
    ...result("progress", copy.preparing, detail),
    publication: publishPublication,
  }
}
