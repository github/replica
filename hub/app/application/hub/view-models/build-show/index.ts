import type { BuildsShowPageData } from "@pages/builds-show-page/types"

import type { BuildResponse, WorkspaceResponse } from "../../contracts"
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
  const author = workspace.viewer.login === build.commitAuthorLogin ? workspace.viewer : null
  const hasScreenshots = Boolean(build.desktopScreenshotUrl && build.narrowScreenshotUrl)

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
      avatarUrl: author?.avatarUrl ?? null,
      label: `By @${build.commitAuthorLogin}`,
      url: `https://github.com/${encodeURIComponent(build.commitAuthorLogin)}`,
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
    publicationHeading: build.previewUrl ? "Local preview" : undefined,
    previewLabel: build.previewUrl ? "View prototype" : undefined,
    previewPath: build.previewUrl
      ? resourcePath(
          `/repositories/${data.repository.id}/prototypes/${data.prototype.id}`,
          search,
          { build: build.number },
        )
      : undefined,
    retainedSizeLabel: build.previewUrl
      ? "Synthetic preview. No Build artifact is stored by this frontend."
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
