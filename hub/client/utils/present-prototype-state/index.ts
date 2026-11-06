import { copy } from "../prototype-canvas/en"
import type { Publication } from "../resolve-prototype-publication"
import type { HubStatus, PrototypeState } from "../prototype-canvas/types"

/** Combines Hub evidence with local stats without presenting stale comparisons as current. */
export function presentPrototypeState(
  state: PrototypeState | null,
  hubStatus: HubStatus | null,
  publication: Publication,
) {
  const sameCheckout =
    hubStatus?.repository === state?.stats.repository && hubStatus?.branch === state?.stats.branch
  const statsBranchUnavailable = !state?.stats.branch && Boolean(state?.stats.branchError)
  const hubBranch = statsBranchUnavailable ? undefined : hubStatus?.branch
  const comparisonOutdated = Boolean(
    state &&
    !statsBranchUnavailable &&
    ((hubStatus?.repository && hubStatus.repository !== state.stats.repository) ||
      (hubStatus?.branch && hubStatus.branch !== state.stats.branch) ||
      (hubStatus?.commitSha && hubStatus.commitSha !== state.stats.commitSha)),
  )
  const hubPublished = Boolean(
    publication.kind === "ready" &&
    sameCheckout &&
    hubStatus?.state === "connected" &&
    hubStatus.prototype?.published &&
    hubStatus.prototype.build?.commitSha === state?.stats.commitSha,
  )
  const presentedState: PrototypeState | null = state && {
    ...state,
    publishStatus:
      (!hubPublished && ["requested", "in_progress"].includes(state.publishStatus?.state ?? "")) ||
      (hubStatus?.state === "connected" && !sameCheckout)
        ? state.publishStatus
        : hubPublished && hubStatus?.prototype?.build
          ? {
              state: "published",
              detail: copy.hubBuildImported,
              versionCount: hubStatus.prototype.versionCount,
              lastUpdatedAt: hubStatus.prototype.build.publishedAt,
              run: {
                url: hubStatus.prototype.build.url,
                actor:
                  hubStatus.prototype.build.author.login || hubStatus.prototype.build.author.name
                    ? {
                        login: hubStatus.prototype.build.author.login || undefined,
                        name: hubStatus.prototype.build.author.name || undefined,
                        avatarUrl: hubStatus.prototype.build.author.avatarUrl || undefined,
                      }
                    : null,
              },
            }
          : {
              state: hubStatus?.state === "connected" ? "not_published" : "unavailable",
              detail:
                hubStatus?.state === "connected"
                  ? copy.hubBuildMissing
                  : copy.hubPublicationUnavailable,
            },
    stats: {
      ...state.stats,
      branch: hubBranch || state.stats.branch,
      branchError: hubBranch && hubBranch !== state.stats.branch ? null : state.stats.branchError,
      repository: hubStatus?.repository || state.stats.repository,
      commitSha: state.stats.commitSha,
      comparison: comparisonOutdated
        ? { branch: null, source: null, behind: null, error: copy.comparisonNeedsRefresh }
        : state.stats.comparison,
      publishedUrl: hubPublished ? hubStatus?.prototype?.build?.url : undefined,
    },
  }
  return { state: presentedState, hubPublished, comparisonOutdated }
}
