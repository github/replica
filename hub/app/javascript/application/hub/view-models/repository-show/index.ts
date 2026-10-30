import type { RepositoriesShowPageData } from "@pages/repositories-show-page/types"

import type { RepositoryResponse, WorkspaceResponse } from "../../contracts"
import { buildStateLabel } from "../build-state-label"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

export function repositoryShowData(
  workspace: WorkspaceResponse,
  data: RepositoryResponse,
  search: URLSearchParams,
): RepositoriesShowPageData {
  const path = `/repositories/${data.repository.id}`
  const pageQuery = new URLSearchParams(search)
  pageQuery.delete("page")
  const pagePath = pageQuery.size ? `${path}?${pageQuery}` : path
  const author = search.get("author") ?? ""
  const selectedAuthor = data.authors.find((item) => item.id === author)
  const authorLabel =
    author === "me"
      ? "Me"
      : selectedAuthor
        ? `@${selectedAuthor.login}`
        : author
          ? "Selected author"
          : "All authors"
  const count = data.pagination.totalCount

  return {
    ...repositoryWorkspace(workspace, data.repository, search),
    alert: null,
    clearSearchLabel: "Clear search",
    emptyHeading: "No prototypes yet",
    emptyLabel: "This repository has no prototypes in the local mock data.",
    buildPrototypeLabel: "Build prototype",
    galleryViewLabel: "Gallery view",
    listViewLabel: "List view",
    prototypeColumnLabel: "Prototype",
    ownerColumnLabel: "Author",
    buildColumnLabel: "Build",
    passingLabel: "passing",
    notPassingLabel: "not passing",
    noBuildLabel: "No Build yet",
    noSearchResultsHeading: "No prototypes found",
    noSearchResultsDescription: "Try a different search or author, or clear the current filters.",
    pageTitle: data.repository.nameWithOwner,
    prototypes: data.prototypes.map((prototype) => {
      const builds = [...prototype.builds].sort((first, second) => second.number - first.number)
      const latestBuild = builds[0]
      const reviewBuild = builds.find((build) => build.previewUrl && build.desktopScreenshotUrl)
      const prototypeAuthor = data.authors.find((item) => item.login === prototype.authorLogin)

      return {
        id: String(prototype.id),
        name: prototype.name,
        branchName: prototype.branchName,
        description: prototype.description,
        path: resourcePath(`${path}/prototypes/${prototype.id}`, search),
        author: {
          avatarUrl: prototypeAuthor?.avatarUrl ?? null,
          label: `By @${prototype.authorLogin}`,
          ownerLabel: `@${prototype.authorLogin}`,
          url: `https://github.com/${encodeURIComponent(prototype.authorLogin)}`,
        },
        latestBuild: latestBuild
          ? { state: latestBuild.state, stateLabel: buildStateLabel(latestBuild.state) }
          : undefined,
        previewFallbackLabel: builds.some((build) => build.previewUrl)
          ? "Preview available. No screenshot was captured."
          : "No preview available",
        reviewBuild: reviewBuild?.desktopScreenshotUrl
          ? {
              number: reviewBuild.number,
              screenshotAlt: `${prototype.name}, Build ${reviewBuild.number}`,
              screenshotSrc: reviewBuild.desktopScreenshotUrl,
            }
          : undefined,
      }
    }),
    prototypesCountLabel: `${count} ${count === 1 ? "prototype" : "prototypes"}`,
    prototypesHeading: "Prototypes",
    searchLabel: "Search prototypes",
    viewLabel: "Prototype layout",
    listing: {
      query: search.get("q") ?? "",
      author,
      authorLabel,
      matchingCount: count,
      page: data.pagination.page,
      pageCount: data.pagination.pageCount,
      pagePath,
      authorsPath: `/api/repositories/${data.repository.id}/authors`,
      path: search.size ? `${path}?${search}` : path,
      copy: {
        author: "Author",
        me: "Me",
        allAuthors: "All authors",
        searchAuthors: "Search authors",
        moreAuthors: "More",
        firstAuthors: "First authors",
        noAuthors: "No matching authors",
        loading: "Loading authors",
        retry: "Retry",
        authorsFailed: "Hub could not load authors. Try again.",
        resultsFailed: "Hub could not load prototypes. Try again.",
        previous: "Previous",
        next: "Next",
        pagination: "Prototype pages",
        updating: "Updating prototypes",
        shown: `${data.prototypes.length} shown`,
      },
    },
  }
}
