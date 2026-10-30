import type { BuildsIndexPageData } from "@pages/builds-index-page/types"

import type { BuildHistoryResponse, WorkspaceResponse } from "../../contracts"
import { buildStateLabel } from "../build-state-label"
import { formatBuildTime } from "../format-build-time"
import { prototypeWorkspace } from "../prototype-workspace"
import { resourcePath } from "../resource-path"

export function buildHistoryData(
  workspace: WorkspaceResponse,
  data: BuildHistoryResponse,
  search: URLSearchParams,
): BuildsIndexPageData {
  const path = `/repositories/${data.repository.id}/prototypes/${data.prototype.id}/builds`
  const selectedBuild =
    data.prototype.builds.find((build) => String(build.number) === search.get("build")) ?? null
  const selectedNumber = selectedBuild?.number ?? null

  return {
    ...prototypeWorkspace({
      workspace,
      repository: data.repository,
      prototype: data.prototype,
      selectedBuild,
      search,
      surface: "history",
    }),
    builds: data.builds.map((build) => ({
      author: {
        avatarUrl:
          workspace.viewer.login === build.commitAuthorLogin ? workspace.viewer.avatarUrl : null,
        label: `By @${build.commitAuthorLogin}`,
        url: `https://github.com/${encodeURIComponent(build.commitAuthorLogin)}`,
      },
      commitLabel: `Commit ${build.commitSha.slice(0, 7)}`,
      commitSha: build.commitSha,
      createdAt: build.createdAt,
      createdLabel: `Created ${formatBuildTime(build.createdAt)}`,
      number: build.number,
      numberLabel: `Build ${build.number}`,
      path: resourcePath(`${path}/${build.number}`, search),
      shortCommitSha: build.commitSha.slice(0, 7),
      state: build.state,
      stateLabel: buildStateLabel(build.state),
    })),
    buildsHeading: "History",
    emptyLabel: "No Builds have been recorded for this prototype.",
    pageTitle: `${data.prototype.name} · Build history`,
    nextPageLabel: "Older Builds",
    nextPagePath:
      data.pagination.page < data.pagination.pageCount
        ? resourcePath(path, search, {
            page: data.pagination.page + 1,
            build: selectedNumber,
          })
        : null,
    newestPageLabel: "Newest Builds",
    newestPagePath:
      data.pagination.page > 1 ? resourcePath(path, search, { build: selectedNumber }) : null,
  }
}
