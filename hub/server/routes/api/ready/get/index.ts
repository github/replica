import type { Request, Response } from "express"
import type { Logger } from "pino"

export async function get(
  _request: Request,
  response: Response,
  { isReady, logger }: { isReady?: () => Promise<boolean>; logger?: Logger } = {},
): Promise<void> {
  try {
    const ready = isReady ? await isReady() : true
    response.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" })
  } catch {
    logger?.warn("Hub readiness dependency check failed")
    response.status(503).json({ status: "unavailable" })
  }
}
