import type { ReviewThread } from "@utils/review-comment/types"

import type { ReviewThreadFilterContext } from "./types"

export function reviewThreadMatchesFilters(
  thread: ReviewThread,
  context: ReviewThreadFilterContext,
) {
  const { root } = thread
  const { filters } = context
  if (!filters.showResolved && root.resolvedAt !== null) return false
  if (!filters.showRead && !thread.unread) return false
  if (
    filters.onlyMine &&
    ![root, ...thread.replies].some(
      (comment) => comment.author.login.toLowerCase() === context.viewerLogin.toLowerCase(),
    )
  ) {
    return false
  }
  if (
    filters.currentBuildOnly &&
    (context.selectedDraftRevisionId != null
      ? root.draftRevisionId !== context.selectedDraftRevisionId
      : root.buildNumber !== context.selectedBuildNumber)
  )
    return false
  if (
    filters.participant !== null &&
    !thread.participants.some(
      (participant) => participant.login.toLowerCase() === filters.participant?.toLowerCase(),
    )
  ) {
    return false
  }

  if (
    filters.currentPageOnly &&
    context.route !== null &&
    (root.anchor.route.pathname !== context.route.pathname ||
      root.anchor.route.search !== context.route.search ||
      root.anchor.route.hash !== context.route.hash)
  ) {
    return false
  }

  const query = filters.search.trim().toLowerCase()
  if (!query) return true

  const anchorContext =
    root.anchor.kind === "element"
      ? [root.anchor.accessibleName, root.anchor.selectedText, root.anchor.tagName]
      : root.anchor.elements.flatMap((element) => [
          element.accessibleName,
          element.textExcerpt,
          element.tagName,
          element.role,
        ])

  return [
    root.body ?? "",
    root.author.login,
    root.author.name ?? "",
    root.buildNumber?.toString() ?? "",
    ...thread.replies.flatMap((reply) => [
      reply.body ?? "",
      reply.author.login,
      reply.author.name ?? "",
    ]),
    ...anchorContext,
  ]
    .join("\n")
    .toLowerCase()
    .includes(query)
}
