import { randomUUID } from "node:crypto"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import {
  AnalyticsTransportError,
  createAnalyticsHttpsTransport,
  type AnalyticsTransport,
} from "../../../integrations/analytics-https/send-request/index.ts"
import {
  claimAnalyticsDelivery,
  claimAnalyticsEnqueues,
  finishAnalyticsDelivery,
  readClaimedAnalyticsDelivery,
  releaseAnalyticsEnqueue,
  removeExpiredAnalyticsEvents,
} from "../../../repositories/analytics/delivery-store/index.ts"
import { eventRetentionMs, maximumDeliveryAttempts } from "../constants.ts"
import { openAnalyticsConfiguration } from "../protect-configuration/index.ts"
import { analyticsResponseFailure, renderAnalyticsDelivery } from "../render-delivery/index.ts"
import type { AnalyticsSettings, DestinationConfiguration } from "../types.ts"

function retentionCutoff(now: Date) {
  return new Date(now.getTime() - eventRetentionMs)
}

export async function recoverAnalyticsDeliveries(
  database: PrismaClient,
  enqueue: (deliveryId: string) => Promise<unknown>,
) {
  const now = new Date()
  const claimedUntil = new Date(now.getTime() + 15 * 60_000)
  const rows = await claimAnalyticsEnqueues(database, now, retentionCutoff(now), claimedUntil)
  let queueFailed = false
  for (const { id } of rows) {
    try {
      await enqueue(id)
    } catch {
      await releaseAnalyticsEnqueue(database, id, claimedUntil)
      queueFailed = true
    }
  }
  if (queueFailed) throw new Error("Could not enqueue all analytics deliveries.")
  return rows.length
}

export async function clearExpiredAnalyticsEvents(database: PrismaClient) {
  let removed = 0
  const cutoff = retentionCutoff(new Date())
  for (let batch = 0; batch < 10; batch++) {
    const count = await removeExpiredAnalyticsEvents(database, cutoff)
    removed += count
    if (count < 5_000) break
  }
  return removed
}

export function createAnalyticsDeliveryProcessor(
  database: PrismaClient,
  settings: AnalyticsSettings,
  transport: AnalyticsTransport = createAnalyticsHttpsTransport(settings.policy),
) {
  return async (id: string) => {
    if (!settings.outboundEnabled) return
    const leaseId = randomUUID()
    const now = new Date()
    const attempts = await claimAnalyticsDelivery(
      database,
      id,
      leaseId,
      now,
      retentionCutoff(now),
      new Date(now.getTime() + 5 * 60_000),
      maximumDeliveryAttempts,
    )
    if (attempts === null) return
    async function readCurrent() {
      const current = await readClaimedAnalyticsDelivery(
        database,
        id,
        leaseId,
        retentionCutoff(new Date()),
      )
      return current &&
        current.destinationRevision === current.destination.revision &&
        current.destination.eventTypes.includes(current.event.eventName)
        ? current
        : null
    }
    async function release() {
      await finishAnalyticsDelivery(database, id, leaseId, {
        state: "pending",
        attempts: { decrement: 1 },
        dueAt: new Date(),
      })
    }
    async function fail(code: string, retryable: boolean) {
      await finishAnalyticsDelivery(database, id, leaseId, {
        state: retryable && attempts! < maximumDeliveryAttempts ? "retryable" : "failed",
        dueAt: new Date(Date.now() + Math.min(30_000 * 2 ** (attempts! - 1), 6 * 60 * 60_000)),
        failureCode: code,
      })
    }
    const claimed = await readCurrent()
    if (!claimed) return release()
    let configuration: DestinationConfiguration
    try {
      configuration = openAnalyticsConfiguration(claimed.destination, settings.encryptionKey)
    } catch {
      return fail("invalid_configuration", false)
    }
    const request = renderAnalyticsDelivery(claimed.event, configuration)
    if (!request) return fail("invalid_payload", false)
    const ciphertext = claimed.destination.configurationCiphertext
    async function maySend() {
      return (await readCurrent())?.destination.configurationCiphertext === ciphertext
    }
    if (!(await maySend())) return release()

    let result
    try {
      result = await transport(request, maySend)
    } catch (error) {
      if (!(error instanceof AnalyticsTransportError)) throw error
      return fail(error.code, error.code === "network_error")
    }
    if (!result) return release()
    const failure = analyticsResponseFailure(configuration, result)
    if (failure) return fail(failure.code, failure.retryable)
    await finishAnalyticsDelivery(database, id, leaseId, {
      state: "succeeded",
      failureCode: null,
      deliveredAt: new Date(),
    })
  }
}
