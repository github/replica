import { z } from "zod"

import { requestJson } from "../request-json"

const analyticsEventSchema = z.enum([
  "prototype_registered",
  "prototype_first_published",
  "build_published",
  "review_comment_created",
  "review_reply_added",
  "review_thread_resolved",
  "review_thread_reopened",
])

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
  authorization: z.object({ id: z.uuid(), expiresAt: z.iso.datetime() }).optional(),
})

const startedAuthorization = z.object({
  authorization: z.object({
    id: z.uuid(),
    expiresAt: z.iso.datetime(),
    authorizationUrl: z.url().refine((value) => {
      const url = new URL(value)
      return (
        url.origin === "https://github.com" &&
        url.pathname === "/login/oauth/authorize" &&
        !url.username &&
        !url.password &&
        !url.hash
      )
    }),
  }),
})
const mutationResult = z.object({ id: z.uuid() })

export function getRepositoryAnalytics(request: Request, repositoryId: string) {
  const url = new URL(`/api/repositories/${repositoryId}/analytics`, request.url)
  const authorizationId = new URL(request.url).searchParams.get("authorizationId")
  if (authorizationId && z.uuid().safeParse(authorizationId).success) {
    url.searchParams.set("authorizationId", authorizationId)
  }
  return requestJson(url, analyticsSchema, {
    signal: request.signal,
  })
}

export function changeRepositoryAnalytics(
  request: Request,
  repositoryId: string,
  change: { path: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown },
) {
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/analytics/destinations${change.path}`, request.url),
    z.union([mutationResult, startedAuthorization]),
    {
      method: change.method,
      body: change.body === undefined ? undefined : JSON.stringify(change.body),
      signal: request.signal,
    },
  )
}

export function finishRepositoryAnalyticsAuthorization(
  request: Request,
  repositoryId: string,
  authorizationId: string,
  operation: "continue" | "cancel",
) {
  return requestJson(
    new URL(
      `/api/repositories/${repositoryId}/analytics/authorizations/${authorizationId}/${operation}`,
      request.url,
    ),
    mutationResult,
    { method: "POST", body: "{}", signal: request.signal },
  )
}
