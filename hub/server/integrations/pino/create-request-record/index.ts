import type { Request, Response } from "express"

import { snapshotRequest } from "../snapshot-request/index.ts"
import type { RequestSnapshot } from "../snapshot-request/types.ts"

/** Keep completion metadata even when an endpoint excludes its payload. */
export function createRequestRecord(
  request: Request,
  response: Response,
  responseTime: number,
  captured: RequestSnapshot = snapshotRequest(request),
) {
  const completed = response.writableFinished && !request.readableAborted
  const { route, ...payload } = captured
  return {
    method: request.method,
    route,
    statusCode: completed ? response.statusCode : null,
    responseTime,
    outcome: completed ? "completed" : "aborted",
    ...(response.locals.omitLogPayload === true ? {} : payload),
  }
}
