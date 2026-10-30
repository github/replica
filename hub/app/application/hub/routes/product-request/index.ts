import type { z } from "zod"

import { readRouteQuery } from "../../read-route-query"
import { mockScenarioHeaders } from "../../requests/mock-scenario-headers"
import { requestJson } from "../../requests/request-json"

export function requestProductJson<T>(
  request: Request,
  path: string,
  schema: z.ZodType<T>,
  mutation?: { method: "POST" | "PATCH" | "DELETE"; body?: unknown },
): Promise<T> {
  return requestJson(new URL(path, request.url), schema, {
    method: mutation?.method ?? "GET",
    body: mutation?.body === undefined ? undefined : JSON.stringify(mutation.body),
    signal: request.signal,
    headers: mockScenarioHeaders(readRouteQuery(request).mockScenario),
  })
}
