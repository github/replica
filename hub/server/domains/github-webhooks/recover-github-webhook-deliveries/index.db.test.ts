import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { GitHubWebhookDeliveryAttempt } from "../../../integrations/github/create-github-webhook-deliveries-client/types.ts"
import { prisma } from "../../../integrations/prisma/index.ts"
import type { GitHubWebhookRecoveryDependencies } from "../types.ts"
import { recoverGitHubWebhookDeliveries } from "./index.ts"

const minute = 60 * 1_000
const day = 24 * 60 * minute
const appId = "123"
const installationId = "456"
let deliveryId = 1

function delivery(fields: Partial<GitHubWebhookDeliveryAttempt> = {}) {
  return {
    id: deliveryId++,
    guid: randomUUID(),
    deliveredAt: new Date(),
    statusCode: 502,
    event: "workflow_job",
    installationId: Number(installationId),
    ...fields,
  } satisfies GitHubWebhookDeliveryAttempt
}

function dependencies(
  pages: GitHubWebhookDeliveryAttempt[][],
  {
    now = () => new Date(),
    redeliver = () => Promise.resolve("requested" as const),
  }: Partial<Pick<GitHubWebhookRecoveryDependencies, "now" | "redeliver">> = {},
) {
  return {
    appId,
    database: prisma,
    installationId,
    listDeliveries: vi.fn<GitHubWebhookRecoveryDependencies["listDeliveries"]>((cursor) => {
      const index = cursor ? Number(cursor) : 0
      return Promise.resolve({
        deliveries: pages[index] ?? [],
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      })
    }),
    logger: { error: vi.fn(), warn: vi.fn() },
    now,
    redeliver: vi.fn(redeliver),
  }
}

async function redelivery(id: string) {
  return await prisma.gitHubWebhookRedelivery.findUnique({ where: { id } })
}

describe("recoverGitHubWebhookDeliveries", () => {
  it("redelivers only missed deliveries the Hub can still handle", async () => {
    const missed = delivery()
    const timedOut = delivery({ statusCode: 0, event: "installation" })
    const branchDeleted = delivery({ event: "delete" })
    const deletedByPush = delivery({ event: "push" })
    const laterDelivered = delivery()
    const received = delivery()
    const ignored = [
      delivery({ statusCode: 400 }),
      delivery({ event: "check_run" }),
      delivery({ installationId: 999 }),
      delivery({ deliveredAt: new Date(Date.now() - 3 * day - minute) }),
      delivery({ guid: "not-a-uuid" }),
    ]
    await prisma.gitHubWebhookDelivery.create({
      data: { id: received.guid, event: "workflow_job", payloadDigest: "a".repeat(64) },
    })
    const recovery = dependencies([
      [{ ...laterDelivered, id: deliveryId++, statusCode: 200 }],
      [missed, timedOut, branchDeleted, deletedByPush, laterDelivered, received, ...ignored],
    ])

    await expect(recoverGitHubWebhookDeliveries(recovery)).resolves.toBe(true)

    expect(recovery.redeliver.mock.calls.map(([id]) => id).sort()).toEqual(
      [missed.id, timedOut.id, branchDeleted.id, deletedByPush.id].sort(),
    )
    expect(await prisma.gitHubWebhookRedelivery.count()).toBe(4)
    expect(await redelivery(missed.guid)).toMatchObject({ state: "waiting", attempts: 1 })
  })

  it("settles a redelivery once the Hub receives it and does not request it again", async () => {
    const missed = delivery()
    let now = new Date()
    const recovery = dependencies([[missed]], { now: () => now })
    await recoverGitHubWebhookDeliveries(recovery)
    await prisma.gitHubWebhookDelivery.create({
      data: { id: missed.guid, event: "workflow_job", payloadDigest: "a".repeat(64) },
    })

    now = new Date(now.getTime() + 2 * minute)
    await recoverGitHubWebhookDeliveries(recovery)

    expect(recovery.redeliver).toHaveBeenCalledOnce()
    expect(await redelivery(missed.guid)).toMatchObject({ state: "succeeded", attempts: 1 })
  })

  it("backs off between attempts and gives up at expiry or the attempt limit", async () => {
    const start = new Date()
    let now = start
    const unavailable = delivery()
    const expiring = delivery({ deliveredAt: new Date(start.getTime() - 3 * day + minute) })
    const exhausted = delivery()
    const recovery = dependencies([[unavailable, expiring]], {
      now: () => now,
      redeliver: (id) => Promise.resolve(id === unavailable.id ? "unavailable" : "requested"),
    })
    await prisma.gitHubWebhookRedelivery.create({
      data: {
        id: exhausted.guid,
        githubDeliveryId: exhausted.id,
        event: "workflow_job",
        state: "waiting",
        attempts: 12,
        retryAt: start,
        expiresAt: new Date(start.getTime() + day),
      },
    })

    await recoverGitHubWebhookDeliveries(recovery)
    expect(await redelivery(unavailable.guid)).toMatchObject({
      state: "waiting",
      attempts: 1,
      failureCode: "remote_unavailable",
      retryAt: new Date(start.getTime() + minute),
    })
    expect(await redelivery(exhausted.guid)).toMatchObject({
      state: "failed",
      failureCode: "attempts_exhausted",
    })

    now = new Date(start.getTime() + 30 * 1_000)
    await recoverGitHubWebhookDeliveries(recovery)
    expect(recovery.redeliver).toHaveBeenCalledTimes(2)

    now = new Date(start.getTime() + 2 * minute)
    await recoverGitHubWebhookDeliveries(recovery)
    expect(await redelivery(expiring.guid)).toMatchObject({
      state: "failed",
      failureCode: "window_expired",
    })
    expect(await redelivery(unavailable.guid)).toMatchObject({
      attempts: 2,
      retryAt: new Date(now.getTime() + 2 * minute),
    })
  })

  it("skips the run while another worker holds the lease", async () => {
    await prisma.gitHubWebhookRecoveryCheckpoint.create({
      data: { appId, leaseId: randomUUID(), leaseExpiresAt: new Date(Date.now() + minute) },
    })
    const recovery = dependencies([[delivery()]])

    await expect(recoverGitHubWebhookDeliveries(recovery)).resolves.toBe(false)
    expect(recovery.listDeliveries).not.toHaveBeenCalled()
  })

  it("resumes a scan from its cursor and stops at the previous scan", async () => {
    const start = new Date()
    let now = start
    const old = delivery({ deliveredAt: new Date(start.getTime() - day) })
    const pages = Array.from({ length: 12 }, () => [delivery({ statusCode: 200 })])
    const recovery = dependencies(pages, { now: () => now })

    await recoverGitHubWebhookDeliveries(recovery)
    expect(recovery.listDeliveries).toHaveBeenCalledTimes(10)
    expect(
      await prisma.gitHubWebhookRecoveryCheckpoint.findUnique({ where: { appId } }),
    ).toMatchObject({ cursor: "10", scanStartedAt: start, leaseId: null })

    now = new Date(start.getTime() + minute)
    await recoverGitHubWebhookDeliveries(recovery)
    expect(recovery.listDeliveries).toHaveBeenLastCalledWith("11")
    expect(
      await prisma.gitHubWebhookRecoveryCheckpoint.findUnique({ where: { appId } }),
    ).toMatchObject({ cursor: null, lastCompletedScanStartedAt: start })

    pages.splice(0, pages.length, [delivery({ statusCode: 200 })], [old], [delivery()])
    recovery.listDeliveries.mockClear()
    now = new Date(start.getTime() + 2 * minute)
    await recoverGitHubWebhookDeliveries(recovery)
    expect(recovery.listDeliveries.mock.calls).toEqual([[null], ["1"]])
  })

  it("keeps redelivering recorded deliveries while GitHub cannot list deliveries", async () => {
    const missed = delivery()
    const recovery = dependencies([[missed]])
    await recoverGitHubWebhookDeliveries(recovery)
    await prisma.gitHubWebhookRedelivery.update({
      where: { id: missed.guid },
      data: { retryAt: new Date() },
    })
    recovery.listDeliveries.mockRejectedValueOnce(new Error("GitHub is down"))

    await recoverGitHubWebhookDeliveries(recovery)

    expect(recovery.redeliver).toHaveBeenCalledTimes(2)
    expect(recovery.logger.warn).toHaveBeenCalledOnce()
  })

  it("deletes settled redeliveries only after the retention period", async () => {
    const now = new Date()
    function row(state: "failed" | "succeeded" | "waiting", updatedAt: Date) {
      const attempt = delivery()
      return {
        id: attempt.guid,
        githubDeliveryId: attempt.id,
        event: "workflow_job",
        state,
        retryAt: new Date(now.getTime() + day),
        expiresAt: new Date(now.getTime() + day),
        updatedAt,
      }
    }
    const old = new Date(now.getTime() - 31 * day)
    const rows = [
      row("succeeded", old),
      row("failed", old),
      row("succeeded", now),
      row("waiting", old),
    ]
    await prisma.gitHubWebhookRedelivery.createMany({ data: rows })

    await recoverGitHubWebhookDeliveries(dependencies([], { now: () => now }))

    const remaining = await prisma.gitHubWebhookRedelivery.findMany({ select: { id: true } })
    expect(remaining.map(({ id }) => id).sort()).toEqual([rows[2]!.id, rows[3]!.id].sort())
  })
})
