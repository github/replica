import { randomUUID } from "node:crypto"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import {
  listAnalyticsDestinations,
  loadAnalyticsDestination,
  queueRetainedAnalyticsEvents,
  readBackfillCandidates,
  updateAnalyticsBacklog,
} from "../../../repositories/analytics/destination-store/index.ts"
import { lockAnalyticsRepository } from "../../../repositories/analytics/lock-repository/index.ts"
import { eventRetentionMs } from "../constants.ts"
import { AnalyticsSettingsError } from "../errors.ts"
import { parseAnalyticsConfiguration } from "../parse-configuration/index.ts"
import {
  openAnalyticsConfiguration,
  sealAnalyticsConfiguration,
} from "../protect-configuration/index.ts"
import type { AnalyticsSettings, CustomHeader, DestinationInput } from "../types.ts"

export interface AnalyticsActor {
  repositoryId: string
  membershipId: string
}

export type AnalyticsMutation =
  | { action: "create"; input: DestinationInput }
  | { action: "update"; destinationId: string; input: DestinationInput }
  | { action: "pause" | "resume" | "delete"; destinationId: string }

const maximumDestinations = 12
const maximumBackfill = 5_000

async function writeAudit(
  tx: Prisma.TransactionClient,
  { repositoryId, membershipId }: AnalyticsActor,
  destinationId: string,
  action: AnalyticsMutation["action"],
) {
  await tx.securityAudit.create({
    data: {
      repositoryId,
      action: `analytics_destination.${action}`,
      outcome: "SUCCESS",
      targetType: "analytics_destination",
      targetId: destinationId,
      context: { repositoryId, actorMembershipId: membershipId },
    },
  })
}

export function createAnalyticsDestinationService(
  database: PrismaClient,
  settings: AnalyticsSettings,
) {
  async function prepare(
    tx: Prisma.TransactionClient,
    repositoryId: string,
    mutation: AnalyticsMutation,
  ) {
    const previous =
      mutation.action === "create"
        ? null
        : await loadAnalyticsDestination(tx, repositoryId, mutation.destinationId)
    if (mutation.action !== "create" && !previous)
      throw new AnalyticsSettingsError(404, "Destination not found.")
    if ("input" in mutation) {
      if (
        mutation.input.includeRetained &&
        (mutation.action !== "create" || !settings.allowRetainedExport)
      ) {
        throw new AnalyticsSettingsError(
          422,
          "Retained-event export is not available for this change.",
        )
      }
      parseAnalyticsConfiguration(
        mutation.input,
        settings.policy,
        previous ? openAnalyticsConfiguration(previous, settings.encryptionKey) : undefined,
      )
    }
    return previous?.updatedAt.toISOString() ?? null
  }

  return {
    prepare,
    async list(repositoryId: string) {
      const rows = await listAnalyticsDestinations(database, repositoryId)
      const destinations = rows.map((row) => {
        const configuration = openAnalyticsConfiguration(row, settings.encryptionKey)
        const shared = {
          id: row.id,
          enabled: row.enabled,
          eventTypes: row.eventTypes,
          deliveryFailed: row.deliveries.some(
            (delivery) => delivery.destinationRevision === row.revision,
          ),
        }
        if (configuration.provider !== "custom") {
          return { ...shared, provider: configuration.provider, region: configuration.region }
        }
        const headers = Object.fromEntries(
          Object.entries(configuration.headers).map(
            ([name, value]): [string, Exclude<CustomHeader, string> | { $keep: true }] => [
              name,
              typeof value === "string" ? { $keep: true } : value,
            ],
          ),
        )
        return {
          ...shared,
          name: configuration.name,
          provider: "custom" as const,
          region: "custom" as const,
          customConfig: {
            version: 1 as const,
            endpoint: configuration.endpoint,
            headers,
            template: configuration.template,
            success_pointer: configuration.successPointer,
            success_value: configuration.successValue,
            secret_names: Object.keys(configuration.secrets).sort(),
          },
        }
      })
      return {
        destinations,
        canExportHistory: settings.allowRetainedExport,
        outboundEnabled: settings.outboundEnabled,
      }
    },

    async mutate(
      actor: AnalyticsActor,
      mutation: AnalyticsMutation,
      confirmCurrent: (tx: Prisma.TransactionClient) => Promise<boolean>,
      targetUpdatedAt?: string | null,
    ) {
      const { repositoryId } = actor
      return database.$transaction(async (tx) => {
        if (!(await confirmCurrent(tx)))
          throw new AnalyticsSettingsError(404, "Repository not found.")
        await lockAnalyticsRepository(tx, repositoryId)
        if (!(await confirmCurrent(tx)))
          throw new AnalyticsSettingsError(404, "Repository not found.")
        const { action } = mutation
        const previous =
          action === "create"
            ? null
            : await loadAnalyticsDestination(tx, repositoryId, mutation.destinationId)
        if (action !== "create" && !previous)
          throw new AnalyticsSettingsError(404, "Destination not found.")
        if (
          targetUpdatedAt !== undefined &&
          targetUpdatedAt !== (previous?.updatedAt.toISOString() ?? null)
        ) {
          throw new AnalyticsSettingsError(
            409,
            "The destination changed during authorization. Review it and try again.",
          )
        }
        if (!("input" in mutation)) {
          const id = previous!.id
          if (action === "delete") await tx.analyticsDestination.delete({ where: { id } })
          else {
            const enabled = action === "resume"
            if (previous!.enabled === enabled) return { id }
            await tx.analyticsDestination.update({ where: { id }, data: { enabled } })
            if (enabled) {
              await tx.analyticsDelivery.updateMany({
                where: { destinationId: id, enqueueClaimExpiresAt: { not: null } },
                data: { enqueueClaimExpiresAt: null },
              })
            }
          }
          await writeAudit(tx, actor, id, action)
          return { id }
        }

        const { input } = mutation
        if (input.includeRetained && (action !== "create" || !settings.allowRetainedExport)) {
          throw new AnalyticsSettingsError(
            422,
            "Retained-event export is not available for this change.",
          )
        }
        const saved = previous
          ? openAnalyticsConfiguration(previous, settings.encryptionKey)
          : undefined
        const { configuration, changedRecipient, keepPending } = parseAnalyticsConfiguration(
          input,
          settings.policy,
          saved,
        )
        const id = previous?.id ?? randomUUID()
        const { provider } = configuration
        const destinationKey =
          provider === "custom" ? `custom/${configuration.name.toLowerCase()}` : provider
        if (
          await tx.analyticsDestination.findFirst({
            where: { repositoryId, destinationKey, id: { not: id } },
            select: { id: true },
          })
        )
          throw new AnalyticsSettingsError(
            409,
            "That provider or destination name is already configured.",
          )
        if (
          !previous &&
          (await tx.analyticsDestination.count({ where: { repositoryId } })) >= maximumDestinations
        ) {
          throw new AnalyticsSettingsError(422, "Disconnect a destination before adding another.")
        }

        const data = {
          destinationKey,
          eventTypes: input.eventTypes,
          revision: (previous?.revision ?? 1) + (changedRecipient ? 1 : 0),
          configurationCiphertext: sealAnalyticsConfiguration(
            { id, repositoryId, provider },
            configuration,
            settings.encryptionKey,
          ),
        }
        const destination = previous
          ? await tx.analyticsDestination.update({ where: { id }, data })
          : await tx.analyticsDestination.create({ data: { ...data, id, repositoryId, provider } })
        if (previous) await updateAnalyticsBacklog(tx, destination, changedRecipient, keepPending)
        if (input.includeRetained) {
          const now = new Date()
          const events = await readBackfillCandidates(
            tx,
            repositoryId,
            input.eventTypes,
            new Date(now.getTime() - eventRetentionMs),
            maximumBackfill + 1,
          )
          if (events.length > maximumBackfill) {
            throw new AnalyticsSettingsError(
              422,
              "Too many retained events. Select fewer event types or start with new events only.",
            )
          }
          await queueRetainedAnalyticsEvents(tx, destination, events, now)
        }
        await writeAudit(tx, actor, id, action)
        return { id }
      })
    },
  }
}
