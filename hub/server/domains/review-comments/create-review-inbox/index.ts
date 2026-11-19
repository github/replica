import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubReviewDirectory } from "../../../integrations/github/create-review-directory/types.ts"
import {
  countUnreadInbox,
  findInboxActivity,
  findInboxPage,
  findInboxRepositories,
  findSessionGitHubSubject,
  inboxWhere,
  saveInboxRead,
} from "../../../repositories/review-comments/inbox-queries/index.ts"
import { githubReviewId } from "../create-review-mention-directory/index.ts"
import { ReviewCommentError } from "../errors.ts"
import type { ReviewActor } from "../types.ts"

interface InboxViewer extends ReviewActor {
  sessionProvider: string | null
  membershipId: string
  role: "MEMBER" | "ADMINISTRATOR"
}

interface InboxContext {
  sessionDigest: string
  viewer: InboxViewer
}

type Db = Pick<
  PrismaClient,
  "$transaction" | "hubSession" | "repository" | "gitHubRepositoryAccessState"
>

export function createReviewInbox(
  database: Db,
  {
    restore,
    repositoryScope,
    github,
  }: {
    restore: (transaction: Prisma.TransactionClient, digest: string) => Promise<InboxViewer | null>
    repositoryScope: (
      database: Pick<Db, "gitHubRepositoryAccessState">,
      viewer: InboxViewer,
    ) => Promise<Prisma.RepositoryWhereInput>
    github?: GitHubReviewDirectory
  },
) {
  async function recipientKeys(
    database: Pick<Db, "hubSession">,
    { sessionDigest, viewer }: InboxContext,
  ) {
    const userKey = `user:${viewer.userId}`
    if (viewer.sessionProvider !== "github") return [userKey]
    const { externalIdentity } = (await findSessionGitHubSubject(database, sessionDigest)) ?? {}
    const githubKey =
      externalIdentity?.provider === "github" && externalIdentity.issuer === "https://github.com"
        ? `github:${externalIdentity.subject}`
        : ""
    return githubReviewId(githubKey) ? [userKey, githubKey] : [userKey]
  }

  async function run<Result>(
    input: InboxContext,
    action: (
      transaction: Prisma.TransactionClient,
      where: Prisma.ReviewNotificationWhereInput,
    ) => Promise<Result>,
  ) {
    const isLocal = input.viewer.sessionProvider === "local"
    const keys = await recipientKeys(database, input)
    const visible = await findInboxRepositories(
      database,
      await repositoryScope(database, input.viewer),
      keys,
      isLocal,
    )
    let verified = new Set(visible.map(({ id }) => id))
    if (github && input.viewer.sessionProvider === "github" && visible.length) {
      const githubId = keys.map(githubReviewId).find(Boolean)
      try {
        const allowed = await Promise.all(
          visible.map(async (repository) =>
            githubId &&
            (await github.find(repository.nameWithOwner, input.viewer.login, githubId))
              ?.githubId === githubId
              ? repository.id
              : null,
          ),
        )
        verified = new Set(allowed.filter((id) => id !== null))
      } catch {
        throw new ReviewCommentError(
          "unavailable",
          "GitHub could not check Inbox access. Try again.",
        )
      }
    }

    return database.$transaction(async (transaction) => {
      const current = await restore(transaction, input.sessionDigest)
      if (
        !current ||
        current.userId !== input.viewer.userId ||
        current.sessionProvider !== input.viewer.sessionProvider ||
        current.membershipId !== input.viewer.membershipId ||
        current.role !== input.viewer.role
      ) {
        throw new ReviewCommentError("unauthorized", "Sign in to continue.")
      }
      const currentKeys = await recipientKeys(transaction, {
        sessionDigest: input.sessionDigest,
        viewer: current,
      })
      const repositories = await findInboxRepositories(
        transaction,
        await repositoryScope(transaction, current),
        currentKeys,
        isLocal,
      )
      const confirmed = repositories.filter(
        (repository) =>
          verified.has(repository.id) &&
          visible.some(
            ({ id, nameWithOwner }) =>
              id === repository.id && nameWithOwner === repository.nameWithOwner,
          ),
      )
      return action(transaction, inboxWhere(currentKeys, confirmed))
    })
  }

  function missing() {
    return new ReviewCommentError("not_found", "Notification not found.")
  }
  return {
    list(input: InboxContext & { unread: boolean; limit: number; before?: number }) {
      return run(input, async (transaction, where) => {
        const results = await findInboxPage(transaction, where, input)
        const notifications = results.slice(0, input.limit)
        return {
          notifications,
          nextBefore:
            results.length > input.limit ? (notifications.at(-1)?.publicId ?? null) : null,
          unreadCount: await countUnreadInbox(transaction, where),
        }
      })
    },
    find(input: InboxContext & { notificationId: number }) {
      return run(input, async (transaction, where) => {
        const notification = await findInboxActivity(transaction, where, input.notificationId)
        if (!notification) throw missing()
        return notification
      })
    },
    setRead(input: InboxContext & { notificationId: number; version: number; read: boolean }) {
      return run(input, async (transaction, where) => {
        const notification = await findInboxActivity(transaction, where, input.notificationId)
        if (!notification) throw missing()
        const changed = await saveInboxRead(
          transaction,
          where,
          notification.id,
          input.version,
          input.read,
        )
        if (!changed)
          throw new ReviewCommentError(
            "conflict",
            "This notification changed. Refresh the Inbox and try again.",
          )
        return {
          version: input.version + 1,
          read: input.read,
          unreadCount: await countUnreadInbox(transaction, where),
        }
      })
    },
  }
}
