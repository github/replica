import { z } from "zod"

import { analyticsEventSchema } from "@application/hub/settings-contracts"

import { requestJson } from "../request-json"

const common = {
  id: z.uuid(),
  enabled: z.boolean(),
  eventTypes: z.array(analyticsEventSchema),
  deliveryFailed: z.boolean(),
}
const destinationSchema = z.union([
  z.object({
    ...common,
    provider: z.enum(["segment", "mixpanel"]),
    region: z.enum(["us", "eu", "in"]),
  }),
  z.object({
    ...common,
    provider: z.literal("custom"),
    region: z.literal("custom"),
    name: z.string(),
    customConfig: z.object({
      version: z.literal(1),
      endpoint: z.string(),
      headers: z.record(
        z.string(),
        z.union([z.object({ $secret: z.string() }), z.object({ $keep: z.literal(true) })]),
      ),
      template: z.json(),
      success_pointer: z.string(),
      success_value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      secret_names: z.array(z.string()),
    }),
  }),
])

const analyticsSchema = z.object({
  destinations: z.array(destinationSchema),
  canExportHistory: z.boolean(),
  outboundEnabled: z.boolean(),
  canMutate: z.boolean(),
})

export function getRepositoryAnalytics(request: Request, repositoryId: string) {
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/analytics`, request.url),
    analyticsSchema,
    {
      signal: request.signal,
    },
  )
}

export function changeRepositoryAnalytics(
  request: Request,
  repositoryId: string,
  change: { path: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown },
) {
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/analytics/destinations${change.path}`, request.url),
    z.object({ id: z.uuid() }),
    {
      method: change.method,
      body: change.body === undefined ? undefined : JSON.stringify(change.body),
      signal: request.signal,
    },
  )
}
