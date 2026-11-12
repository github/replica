import type { BuildsShowPageData } from "@pages/builds-show-page/types"
import type { BuildResponse, WorkspaceResponse } from "@application/hub/contracts/types"

import { buildStateLabel } from "../build-state-label"
import { formatBuildTime } from "../format-build-time"
import { prototypeWorkspace } from "../prototype-workspace"
import { resourcePath } from "../resource-path"

export function buildShowData(
  workspace: WorkspaceResponse,
  data: BuildResponse,
  search: URLSearchParams,
): BuildsShowPageData {
  const build = data.build
  const hasScreenshots = Boolean(build.desktopScreenshotUrl && build.narrowScreenshotUrl)
  const githubAuthor =
    build.commitAuthorProvider === undefined || build.commitAuthorProvider === "github"
  const authorName =
    githubAuthor && build.commitAuthorLogin
      ? `@${build.commitAuthorLogin}`
      : build.commitAuthorName || build.commitAuthorLogin
  const authorAvatarUrl =
    build.commitAuthorAvatarUrl ??
    (workspace.viewer.login === build.commitAuthorLogin &&
    (build.commitAuthorProvider === undefined ||
      build.commitAuthorProvider === workspace.viewer.provider)
      ? workspace.viewer.avatarUrl
      : null)

  return {
    ...prototypeWorkspace({
      workspace,
      repository: data.repository,
      prototype: data.prototype,
      selectedBuild: build,
      search,
      surface: "build",
    }),
    commitAuthor: {
      avatarUrl: authorAvatarUrl,
      label: authorName ? `By ${authorName}` : "Unknown author",
      url:
        githubAuthor && build.commitAuthorLogin
          ? `https://github.com/${encodeURIComponent(build.commitAuthorLogin)}`
          : null,
    },
    commitHeading: "Exact commit",
    commitSha: build.commitSha,
    createdAt: build.createdAt,
    createdLabel: `Created ${formatBuildTime(build.createdAt)}`,
    failureHeading: build.failureSummary ? "Build failed" : undefined,
    failureSummary: build.failureSummary ?? undefined,
    finishedAt: build.finishedAt ?? undefined,
    finishedLabel: build.finishedAt ? `Finished ${formatBuildTime(build.finishedAt)}` : undefined,
    heading: `Build ${build.number}`,
    pageTitle: `Build ${build.number} · ${data.prototype.name}`,
    publicationHeading: build.previewUrl ? "Stored build output" : undefined,
    previewLabel: build.previewUrl ? "View prototype" : undefined,
    previewPath: build.previewUrl
      ? resourcePath(
          `/repositories/${data.repository.id}/prototypes/${data.prototype.id}`,
          search,
          { build: build.number },
        )
      : undefined,
    screenshotsHeading: hasScreenshots ? "Screenshots" : undefined,
    desktopScreenshot: build.desktopScreenshotUrl
      ? {
          alt: `${data.prototype.name}, Build ${build.number}, desktop`,
          label: "Desktop",
          src: build.desktopScreenshotUrl,
        }
      : undefined,
    narrowScreenshot: build.narrowScreenshotUrl
      ? {
          alt: `${data.prototype.name}, Build ${build.number}, narrow viewport`,
          label: "Narrow viewport",
          src: build.narrowScreenshotUrl,
        }
      : undefined,
    startedAt: build.startedAt ?? undefined,
    startedLabel: build.startedAt ? `Started ${formatBuildTime(build.startedAt)}` : undefined,
    state: build.state,
    stateLabel: buildStateLabel(build.state),
    timelineHeading: "Timeline",
  }
}
