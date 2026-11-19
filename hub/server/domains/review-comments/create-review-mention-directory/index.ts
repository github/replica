import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubReviewDirectory } from "../../../integrations/github/create-review-directory/types.ts"
import {
  findLocalReviewPeople,
  findReviewRepository,
  readMentionSource,
} from "../../../repositories/review-comments/collaboration-queries/index.ts"
import { ReviewCommentError } from "../errors.ts"
import type { ReviewMentionRecipient, ReviewMutationScope } from "../types.ts"

type Database = Pick<PrismaClient, "repository" | "reviewComment" | "userProfile">

const validLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const mentionToken =
  /(?<![A-Za-z0-9_@/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9_-])/g

export function reviewMentionLogins(body: string) {
  const logins = [
    ...new Set([...body.matchAll(mentionToken)].map((match) => match[1]!.toLowerCase())),
  ]
  if (logins.length > 10) {
    throw new ReviewCommentError("invalid", "Each message can mention at most 10 distinct people.")
  }
  return logins
}

export function githubReviewId(key: string) {
  const id = key.startsWith("github:") ? Number(key.slice(7)) : 0
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export function createReviewMentionDirectory(database: Database, github?: GitHubReviewDirectory) {
  function unavailable() {
    return new ReviewCommentError(
      "mention_unavailable",
      "GitHub could not check mentions. Try again.",
    )
  }
  async function repository(repositoryId: string, prototypeId: string) {
    const result = await findReviewRepository(database, repositoryId, prototypeId)
    if (!result) throw new ReviewCommentError("not_found", "Reviewable prototype not found.")
    return result
  }
  return {
    async search(repositoryId: string, prototypeId: string, query: string, viewerId: string) {
      const source = await repository(repositoryId, prototypeId)
      if (source.localPath) {
        return (await findLocalReviewPeople(database, query, false))
          .filter(({ login, userId }) => userId !== viewerId && validLogin.test(login))
          .map(({ login }) => ({ login, avatarUrl: null }))
      }
      if (!github) throw unavailable()
      try {
        return await github.search(source.nameWithOwner, query)
      } catch {
        throw unavailable()
      }
    },
    async resolve(
      input: ReviewMutationScope & { commentId?: number },
      logins: string[],
    ): Promise<{ mentions: ReviewMentionRecipient[]; expectedBody?: string }> {
      if (!logins.length) return { mentions: [] }
      const source = await repository(input.repositoryId, input.prototypeId)
      let existing: Awaited<ReturnType<typeof readMentionSource>> = null
      if (input.commentId) {
        existing = await readMentionSource(
          database,
          input.repositoryId,
          input.prototypeId,
          input.commentId,
          input.actor.userId,
        )
        // Let the mutation enforce message ownership and deletion without contacting GitHub.
        if (!existing) return { mentions: [] }
      }
      const mentions = await Promise.all(
        logins.map(async (login) => {
          const previous = existing?.mentions.find((mention) => mention.login === login)
          if (source.localPath) {
            const matches = await findLocalReviewPeople(database, login, true)
            if (matches.length !== 1) return null
            const recipientKey = `user:${matches[0]!.userId}`
            return previous && previous.recipientKey !== recipientKey
              ? null
              : { login, recipientKey }
          }
          if (!github) throw unavailable()
          try {
            const previousId = previous ? githubReviewId(previous.recipientKey) : undefined
            const profile = await github.find(source.nameWithOwner, login, previousId)
            return profile && (!previous || profile.githubId === previousId)
              ? { login, recipientKey: `github:${profile.githubId}` }
              : null
          } catch {
            throw unavailable()
          }
        }),
      )
      return {
        mentions: mentions.filter((mention) => mention !== null),
        expectedBody: existing?.body,
      }
    },
  }
}
