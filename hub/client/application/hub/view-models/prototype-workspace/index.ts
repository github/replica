import type { PrototypeWorkspaceData } from "@features/prototype-workspace"
import type {
  BuildRecord,
  PrototypeRecord,
  RepositoryRecord,
  WorkspaceResponse,
} from "@application/hub/contracts/types"

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
  real = false,
}: {
  workspace: WorkspaceResponse
  repository: RepositoryRecord
  prototype: PrototypeRecord
  selectedBuild: BuildRecord | null
  search: URLSearchParams
  surface: "preview" | "build" | "history"
  real?: boolean
}): PrototypeWorkspaceData {
  const path = `/repositories/${repository.id}/prototypes/${prototype.id}`
  const builds = [...prototype.builds].sort((first, second) => second.number - first.number)
  const latestBuild =
    prototype.latestBuild === undefined
      ? builds[0]
      : (builds.find(({ number }) => number === prototype.latestBuild?.number) ??
        prototype.latestBuild)
  const pinnedBuild = search.has("build") ? (selectedBuild?.number ?? null) : null
  const githubAuthor =
    prototype.authorProvider === undefined || prototype.authorProvider === "github"
  const authorName =
    githubAuthor && prototype.authorLogin
      ? `@${prototype.authorLogin}`
      : prototype.authorName || prototype.authorLogin
  const author =
    prototype.authorLogin &&
    workspace.viewer.login === prototype.authorLogin &&
    (prototype.authorProvider === undefined ||
      prototype.authorProvider === workspace.viewer.provider)
      ? workspace.viewer
      : null
  const previewPath = resourcePath(path, search, {
    build: selectedBuild?.previewUrl ? selectedBuild.number : null,
  })

  return {
    ...repositoryWorkspace(workspace, repository, search, real),
    author: {
      avatarUrl: author?.avatarUrl ?? null,
      label: authorName ? `By ${authorName}` : "Unknown author",
      url:
        githubAuthor && prototype.authorLogin
          ? `https://github.com/${encodeURIComponent(prototype.authorLogin)}`
          : null,
    },
    branchName: prototype.branchName,
    branchPath: resourcePath(path, search),
    prototypeName: prototype.name,
    // Only successful Builds have a preview to open; History still lists the rest.
    buildOptions: builds
      .filter((build) => build.state === "successful")
      .map((build) => ({
        number: build.number,
        label: `v${build.number}`,
        path: resourcePath(path, search, { build: build.number }),
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
    selectedBuildNumber: selectedBuild?.number,
    selectedBuild: selectedBuild ? { number: selectedBuild.number } : undefined,
    useDarkThemeLabel: "Use dark theme",
    useLightThemeLabel: "Use light theme",
  }
}
