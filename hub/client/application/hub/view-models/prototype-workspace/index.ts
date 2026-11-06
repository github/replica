import type { PrototypeWorkspaceData } from "@features/prototype-workspace"

import type {
  BuildRecord,
  PrototypeRecord,
  RepositoryRecord,
  WorkspaceResponse,
} from "../../contracts/types"
import { buildStateLabel } from "../build-state-label"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

export function prototypeWorkspace({
  workspace,
  repository,
  prototype,
  selectedBuild,
  search,
  surface,
}: {
  workspace: WorkspaceResponse
  repository: RepositoryRecord
  prototype: PrototypeRecord
  selectedBuild: BuildRecord | null
  search: URLSearchParams
  surface: "preview" | "build" | "history"
}): PrototypeWorkspaceData {
  const path = `/repositories/${repository.id}/prototypes/${prototype.id}`
  const builds = [...prototype.builds].sort((first, second) => second.number - first.number)
  const latestBuild = builds[0]
  const pinnedBuild = search.has("build") ? (selectedBuild?.number ?? null) : null
  const author = workspace.viewer.login === prototype.authorLogin ? workspace.viewer : null
  const previewPath = resourcePath(path, search, {
    build: selectedBuild?.previewUrl ? selectedBuild.number : null,
  })

  return {
    ...repositoryWorkspace(workspace, repository, search),
    author: {
      avatarUrl: author?.avatarUrl ?? null,
      label: `By @${prototype.authorLogin}`,
      url: `https://github.com/${encodeURIComponent(prototype.authorLogin)}`,
    },
    branchName: prototype.branchName,
    branchPath: resourcePath(path, search),
    prototypeName: prototype.name,
    buildOptions: builds.map((build) => ({
      number: build.number,
      label: `v${build.number}`,
      path:
        surface === "preview" && build.previewUrl
          ? resourcePath(path, search, { build: build.number })
          : resourcePath(`${path}/builds/${build.number}`, search),
      state: build.state,
      stateLabel: buildStateLabel(build.state),
    })),
    buildSelectionLabel: "Choose build",
    closeLabel: surface === "preview" ? "Return to prototypes" : "Return to prototype",
    closePath: surface === "preview" ? undefined : previewPath,
    historyLabel: "History",
    historyPath: resourcePath(`${path}/builds`, search, {
      build: pinnedBuild,
    }),
    latestBuild: latestBuild
      ? {
          number: latestBuild.number,
          state: latestBuild.state,
          stateLabel: buildStateLabel(latestBuild.state),
        }
      : undefined,
    newerBuildLabel:
      latestBuild?.state === "failed" &&
      selectedBuild &&
      latestBuild.number !== selectedBuild.number
        ? "The latest update failed. You're viewing an earlier version."
        : undefined,
    moreActionsLabel: "More actions",
    shareLinksLabel: "Share links",
    shareLinksPath: resourcePath(`${path}/share-links`, search, {
      build: pinnedBuild,
    }),
    prototypeInfoLabel: "About this prototype",
    repositoryPath: resourcePath(`/repositories/${repository.id}`, search),
    selectedBuild: selectedBuild
      ? {
          number: selectedBuild.number,
          detailsLabel: "Build details",
          detailsPath: resourcePath(`${path}/builds/${selectedBuild.number}`, search),
        }
      : undefined,
    useDarkThemeLabel: "Use dark theme",
    useLightThemeLabel: "Use light theme",
  }
}
