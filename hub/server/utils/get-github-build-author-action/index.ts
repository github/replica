export function getGitHubBuildAuthorAction(
  existing: {
    authorProvider: string | null
    authorIssuer: string | null
    authorProviderUserId: string | null
    authorLogin: string | null
    authorName: string | null
    authorAvatarUrl: string | null
  },
  author: { providerUserId: string; login: string | null },
): "would-update" | "unchanged" | "preserved" {
  const noIdentity =
    existing.authorProvider === null &&
    existing.authorIssuer === null &&
    existing.authorProviderUserId === null
  const sameIdentity =
    existing.authorProvider === "github" &&
    existing.authorIssuer === "https://github.com" &&
    existing.authorProviderUserId === author.providerUserId
  if (
    (!noIdentity && !sameIdentity) ||
    (noIdentity &&
      (existing.authorLogin !== null ||
        existing.authorName !== null ||
        existing.authorAvatarUrl !== null))
  ) {
    return "preserved"
  }
  if (noIdentity && !author.login) {
    throw new Error("A GitHub author login is required to record a new identity.")
  }
  return noIdentity ? "would-update" : "unchanged"
}
