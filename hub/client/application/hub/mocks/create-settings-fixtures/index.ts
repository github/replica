import type { InboxNotification } from "@utils/notification/types"

import type { SettingsAuditEvent } from "@application/hub/settings-contracts/types"

import type { MockFlowContext } from "../flow-context/types"
import reviewSeed from "../review-seed.json"

const excerpts = [
  "Could you review the primary action, @octocat?",
  "The label now describes the next step.",
  "A visible label would make this field easier to use.",
  "The review conversation is resolved.",
  "The keyboard focus now returns to the selected item.",
  "The empty state explains how to add the first item.",
  "Please keep the selected filter when returning from the details.",
  "The updated layout works well at the narrower width.",
] as const

const auditActivity = [
  ["canvas-approve", "Repository access approved for the prototype canvas."],
  ["analytics-save", "Review comment and build events enabled for the analytics destination."],
  ["learning-decide", "Accepted guidance to keep form labels visible."],
  ["analytics-state", "Analytics delivery resumed after the configuration update."],
  ["canvas-revoke", "An expired canvas access grant was revoked."],
  ["learning-run", "Review feedback processed into repository guidance."],
  ["learning-save", "Updated guidance for keyboard navigation and focus."],
  ["analytics-save", "Analytics event selection updated for the repository."],
] as const

export function createSettingsFixtures(context: MockFlowContext) {
  const repository = context.resources.repositories[0]
  const auditEvents: SettingsAuditEvent[] = Array.from({ length: 65 }, (_, index) => {
    const [operation, detail] = auditActivity[index % auditActivity.length]!
    return {
      id: index + 1,
      createdAt: new Date(Date.parse("2026-10-30T12:00:00Z") + index * 3_600_000).toISOString(),
      actor: index % 4 === 0 ? "mona" : "octocat",
      operation,
      repositoryId: repository?.id ?? null,
      context: detail,
    }
  })
  const notifications: Array<InboxNotification & { recipientLogin: string }> = []
  let nextThreadId = 1
  const targets = reviewSeed.flatMap((item) => {
    const prototype = context.resources.prototypes.find(
      (entry) => entry.id === item.prototypeId && entry.repositoryId === item.repositoryId,
    )
    const owner = context.resources.repositories.find((entry) => entry.id === item.repositoryId)
    if (
      !prototype ||
      !owner ||
      !context.resources.builds.some(
        (entry) =>
          entry.repositoryId === item.repositoryId &&
          entry.prototypeId === item.prototypeId &&
          entry.number === item.buildNumber &&
          entry.previewUrl,
      )
    )
      return []
    const target = { prototype, owner, buildNumber: item.buildNumber, threadId: nextThreadId }
    nextThreadId += 2
    return [target]
  })
  const actors = context.resources.users.filter((user) => user.login !== "octocat")
  if (!targets.length || !actors.length) return { notifications, auditEvents }

  const kinds = ["mention", "reply", "comment", "resolved", "reopened"] as const
  for (let index = 0; index < 64; index += 1) {
    const id = index + 1
    const target = targets[index < 4 ? 0 : (index - 4) % targets.length]!
    const actor = actors[index < 4 ? 0 : (index - 4) % actors.length]!
    notifications.push({
      id,
      version: 0,
      recipientLogin: "octocat",
      actor: { login: actor.login, name: actor.name, avatarUrl: actor.avatarUrl },
      kind: kinds[index < 4 ? index : index % kinds.length]!,
      excerpt: excerpts[index % excerpts.length]!,
      createdAt: new Date(Date.parse("2026-10-30T12:00:00Z") + index * 2_880_000).toISOString(),
      read: index === 3 || (index > 3 && index % 3 === 0),
      repository: target.owner.nameWithOwner,
      prototype: target.prototype.name,
      path: `/repositories/${target.owner.id}/prototypes/${target.prototype.id}?build=${target.buildNumber}&comment=${target.threadId}&notification=${id}`,
      updatePath: `/notifications/${id}`,
      target: {
        prototypeId: target.prototype.id,
        threadId: target.threadId,
        commentId: target.threadId,
      },
    })
  }
  return { notifications, auditEvents }
}
