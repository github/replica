import type { Request } from "express"

import { sensitiveRequestLogKeyPattern } from "../../../utils/logging/sanitize-log-value/constants.ts"
import { sanitizeLogValue } from "../../../utils/logging/sanitize-log-value/index.ts"

import type { RequestSnapshot } from "./types.ts"

/** Retain safe route data before Express restores a mounted router's parameters. */
export function snapshotRequest(request: Request): RequestSnapshot {
  const route: unknown = request.route
  const path =
    route !== null && typeof route === "object" && "path" in route ? route.path : undefined
  return {
    route: typeof path === "string" ? path : null,
    params: sanitizeLogValue(request.params, sensitiveRequestLogKeyPattern),
    query: sanitizeLogValue(request.query, sensitiveRequestLogKeyPattern),
    ...(request.is("application/json") && request.body !== undefined
      ? { body: sanitizeLogValue(request.body, sensitiveRequestLogKeyPattern) }
      : {}),
  }
}
