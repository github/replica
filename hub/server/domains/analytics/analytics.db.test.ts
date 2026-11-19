import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { AnalyticsTransport } from "../../integrations/analytics-https/send-request"
import { prisma } from "../../integrations/prisma"
import { eventRetentionMs } from "./constants"
import { createAnalyticsDestinationService } from "./create-destination-service"
import {
  clearExpiredAnalyticsEvents,
  createAnalyticsDeliveryProcessor,
  recoverAnalyticsDeliveries,
} from "./deliver"
import { recordAnalyticsEvent, recordSuccessfulBuildAnalytics } from "./record-event"
import type { AnalyticsSettings, DestinationInput } from "./types"

const settings: AnalyticsSettings = {
  applicationOrigin: "http://127.0.0.1:5173",
  encryptionKey: Buffer.alloc(32, 7),
  allowRetainedExport: false,
  outboundEnabled: true,
  policy: { hubHosts: ["127.0.0.1"] },
}

async function createRepository() {
  const repository = await prisma.repository.create({
    data: { nameWithOwner: "local/synthetic", defaultBranch: "main" },
  })
  return repository.id
}

async function createPrototype(repositoryId: string) {
  return prisma.prototype.create({
    data: { repositoryId, branchName: randomUUID(), registeredAt: new Date(), name: "Synthetic" },
  })
}

describe("durable repository analytics", () => {
  it("keeps facts atomic and records first publication only once, including after retention expiry", async () => {
    const repositoryId = await createRepository()
    const prototype = await createPrototype(repositoryId)
    const ids = { repositoryId, prototypeId: prototype.id }
    const registered = { ...ids, eventName: "prototype_registered" as const }
    await expect(
      prisma.$transaction(async (tx) => {
        await recordAnalyticsEvent(tx, registered)
        throw new Error("product transition rolled back")
      }),
    ).rejects.toThrow("product transition rolled back")
    expect(await prisma.analyticsEvent.count()).toBe(0)
    const event = await prisma.$transaction((tx) => recordAnalyticsEvent(tx, registered))
    await expect(
      prisma.$transaction((tx) => recordAnalyticsEvent(tx, registered)),
    ).resolves.toEqual(event)

    async function publish(number: number) {
      return prisma.$transaction(async (tx) => {
        const build = await tx.build.create({
          data: { prototypeId: prototype.id, number, state: "successful" },
        })
        return recordSuccessfulBuildAnalytics(tx, { ...ids, buildId: build.id })
      })
    }
    const first = await publish(1)
    expect(await prisma.analyticsEvent.findUnique({ where: first })).toMatchObject({
      eventName: "prototype_first_published",
    })
    await prisma.analyticsEvent.updateMany({
      data: { occurredAt: new Date(Date.now() - eventRetentionMs - 5_000) },
    })
    expect(await clearExpiredAnalyticsEvents(prisma)).toBe(2)
    const next = await publish(2)
    expect(await prisma.analyticsEvent.findUnique({ where: next })).toMatchObject({
      eventName: "build_published",
    })
  })

  it("isolates new work by repo, recovers a transient send failure with the same UUID, and deletes only delivery data on disconnect", async () => {
    const repositoryId = await createRepository()
    const otherRepositoryId = await createRepository()
    const service = createAnalyticsDestinationService(prisma, settings)
    const actor = { repositoryId, membershipId: randomUUID() }
    function local() {
      return Promise.resolve(true)
    }
    async function register(id: string) {
      const prototype = await createPrototype(id)
      const event = await prisma.$transaction((tx) =>
        recordAnalyticsEvent(tx, {
          repositoryId: id,
          prototypeId: prototype.id,
          eventName: "prototype_registered",
        }),
      )
      return { id: event.id, prototypeId: prototype.id }
    }
    await register(repositoryId)
    const input: DestinationInput = {
      provider: "custom",
      eventTypes: ["prototype_registered"],
      configuration: {
        name: "Synthetic sink",
        endpoint: "https://events.example.com/collect",
        headers: { authorization: { $secret: "service" }, "x-channel": "synthetic-channel" },
        secrets: [{ name: "service", value: "Bearer synthetic-local-only" }],
        template: {
          event: { $field: "event_name" },
          properties: { $field: "properties" },
          person: { $field: "actor_id", when_missing: null },
        },
        successPointer: "/accepted",
        successValue: true,
      },
    }
    const destination = await service.mutate(actor, { action: "create", input }, local)
    expect(JSON.stringify(await service.list(repositoryId))).not.toMatch(
      /synthetic-local-only|synthetic-channel/,
    )
    expect(await prisma.analyticsDelivery.count()).toBe(0)
    await service.mutate(actor, { action: "pause", destinationId: destination.id }, local)
    await register(otherRepositoryId)
    const event = await register(repositoryId)
    const enqueue = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined)
    await expect(recoverAnalyticsDeliveries(prisma, enqueue)).resolves.toBe(0)
    await service.mutate(actor, { action: "resume", destinationId: destination.id }, local)
    await expect(recoverAnalyticsDeliveries(prisma, enqueue)).resolves.toBe(1)
    await expect(recoverAnalyticsDeliveries(prisma, enqueue)).resolves.toBe(0)

    const transport = vi
      .fn<AnalyticsTransport>()
      .mockResolvedValueOnce({ status: 503, body: "synthetic provider data" })
      .mockResolvedValueOnce({ status: 200, body: '{"accepted":true}' })
    const process = createAnalyticsDeliveryProcessor(prisma, settings, transport)
    const deliveryId = enqueue.mock.calls[0]![0]
    await Promise.all([process(deliveryId), process(deliveryId)])
    expect(await prisma.analyticsDelivery.findUnique({ where: { id: deliveryId } })).toMatchObject({
      failureCode: "server_error",
      state: "retryable",
      attempts: 1,
    })
    await prisma.analyticsDelivery.update({
      where: { id: deliveryId },
      data: { dueAt: new Date(0) },
    })
    await process(deliveryId)
    expect(transport.mock.calls.map(([request]) => request.headers["x-replica-event-id"])).toEqual([
      event.id,
      event.id,
    ])
    expect(JSON.parse(transport.mock.calls[1]![0].body)).toEqual({
      event: "prototype_registered",
      properties: { repository_id: repositoryId, prototype_id: event.prototypeId },
      person: null,
    })
    expect(await prisma.analyticsDelivery.findUnique({ where: { id: deliveryId } })).toMatchObject({
      state: "succeeded",
      attempts: 2,
    })
    await service.mutate(actor, { action: "delete", destinationId: destination.id }, local)
    expect(await prisma.analyticsDelivery.count()).toBe(0)
    expect(await prisma.analyticsEvent.count()).toBe(3)
  })
})
