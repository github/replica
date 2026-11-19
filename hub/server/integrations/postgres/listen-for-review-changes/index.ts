import { setTimeout as delay } from "node:timers/promises"
import pg from "pg"
import type { Logger } from "pino"

export async function listenForReviewChanges({
  databaseUrl,
  signal,
  logger,
  changed,
  resynchronize,
}: {
  databaseUrl: string
  signal: AbortSignal
  logger: Logger
  changed: (scope: string) => void
  resynchronize: () => void
}) {
  let backoff = 250
  while (!signal.aborted) {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 })
    let disconnect!: () => void
    const disconnected = new Promise<void>((resolve) => {
      disconnect = resolve
    })
    client.on("error", disconnect)
    client.once("end", disconnect)
    client.on("notification", ({ channel, payload }) => {
      if (!signal.aborted && channel === "hub_review_changes" && payload) changed(payload)
    })
    signal.addEventListener("abort", disconnect, { once: true })
    try {
      await client.connect()
      if (signal.aborted) return
      await client.query("LISTEN hub_review_changes")
      if (signal.aborted) return
      logger.info("Review live updates are listening")
      // Socket clients re-fetch if the listener was not active when they subscribed.
      resynchronize()
      backoff = 250
      await disconnected
    } catch {
      // No connection strings, SQL, or messages from upstream belong in logs.
    } finally {
      signal.removeEventListener("abort", disconnect)
      await client.end().catch(() => undefined)
    }
    if (signal.aborted) break
    logger.warn("Review live updates lost the PostgreSQL listener; reconnecting")
    await delay(backoff, undefined, { signal }).catch(() => undefined)
    backoff = Math.min(backoff * 2, 5000)
  }
}
