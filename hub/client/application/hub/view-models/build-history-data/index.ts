import type { BuildsIndexPageData } from "@pages/builds-index-page/types"
import type { BuildHistoryResponse, WorkspaceResponse } from "@application/hub/contracts/types"

import { buildStateLabel } from "../build-state-label"
import { formatBuildTime } from "../format-build-time"
import { prototypeWorkspace } from "../prototype-workspace"
import { resourcePath } from "../resource-path"

export function buildHistoryData(
  workspace: WorkspaceResponse,
  data: BuildHistoryResponse,
  search: URLSearchParams,
): BuildsIndexPageData {
  const prototypePath = `/repositories/${data.repository.id}/prototypes/${data.prototype.id}`
  const path = `${prototypePath}/builds`
  const selectedBuild =
    data.prototype.builds.find(
      (build) => build.state === "successful" && String(build.number) === search.get("build"),
    ) ?? null
  const selectedNumber = selectedBuild?.number ?? null
  const workspaceData = prototypeWorkspace({
    workspace,
    repository: data.repository,
    prototype: data.prototype,
    selectedBuild,
    search,
    surface: "history",
  })

  return {
    ...workspaceData,
    shareLinksPath: data.prototype.canManageShareLinks ? workspaceData.shareLinksPath : undefined,
    builds: data.builds.map((build) => {
      const githubAuthor =
        build.commitAuthorProvider === undefined || build.commitAuthorProvider === "github"
      const authorName =
        githubAuthor && build.commitAuthorLogin
          ? `@${build.commitAuthorLogin}`
          : build.commitAuthorName || build.commitAuthorLogin
      return {
        author: {
          avatarUrl:
            build.commitAuthorAvatarUrl ??
            (workspace.viewer.login === build.commitAuthorLogin &&
            (build.commitAuthorProvider === undefined ||
              build.commitAuthorProvider === workspace.viewer.provider)
              ? workspace.viewer.avatarUrl
              : null),
          label: authorName ? `By ${authorName}` : "Unknown author",
          url:
            githubAuthor && build.commitAuthorLogin
              ? `https://github.com/${encodeURIComponent(build.commitAuthorLogin)}`
              : null,
        },
        commitLabel: build.commitSha
          ? `Commit ${build.commitSha.slice(0, 7)}`
          : "Commit unavailable",
        commitSha: build.commitSha,
        createdAt: build.createdAt,
        createdLabel: `Added to Hub ${formatBuildTime(build.createdAt)}`,
        number: build.number,
        numberLabel: `Build ${build.number}`,
        path:
          build.state === "successful"
            ? resourcePath(prototypePath, { build: build.number })
            : null,
        shortCommitSha: build.commitSha?.slice(0, 7) ?? null,
        state: build.state,
        stateLabel: buildStateLabel(build.state),
      }
    }),
    buildsHeading: "History",
    emptyLabel: "No Builds have been recorded for this prototype.",
    pageTitle: `${data.prototype.name} · Build history`,
    nextPageLabel: "Older Builds",
    nextPagePath:
      data.pagination.page < data.pagination.pageCount
        ? resourcePath(path, {
            page: data.pagination.page + 1,
            build: selectedNumber,
          })
        : null,
    newestPageLabel: "Newest Builds",
    newestPagePath: data.pagination.page > 1 ? resourcePath(path, { build: selectedNumber }) : null,
  }
}
