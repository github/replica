import type { z } from "zod"

import { settingsQuerySchema } from "../../settings-contracts"
import type { SettingsOperation } from "../../settings-contracts"
import { ApiRequestError } from "../api-request-error"
import { mockScenarioHeaders } from "../mock-scenario-headers"
import { requestJson } from "../request-json"

export function settingsRequest<T>(
  request: Request,
  path: "workspace" | "public" | "actions" | "admin-candidates",
  schema: z.ZodType<T>,
  operation?: SettingsOperation,
) {
  const source = new URL(request.url)
  const query = settingsQuerySchema.safeParse(Object.fromEntries(source.searchParams))
  if (!query.success) throw new ApiRequestError(400, "Invalid mock settings filters.")
  const url = new URL(`/api/settings/${path}`, source.origin)
  url.search = source.search
  return requestJson(url, schema, {
    method: operation ? "POST" : "GET",
    body: operation ? JSON.stringify(operation) : undefined,
    signal: request.signal,
    headers: mockScenarioHeaders(query.data.mockScenario),
  })
}
