import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import type {
  GitHubWebhookDeliveriesClientInput,
  GitHubWebhookDeliveriesClientOptions,
  GitHubWebhookDeliveryAttempt,
} from "./types.ts"

const deliveriesPath = "/app/hook/deliveries"
const pageSize = "100"
const deliveriesSchema = z.array(
  z.looseObject({
    id: z.number().int().positive(),
    guid: z.string().max(100),
    delivered_at: z.iso.datetime({ offset: true }),
    status_code: z.number().int().nullable(),
    event: z.string().max(100),
    installation_id: z.number().int().positive().nullish(),
  }),
)

/**
 * Accepts GitHub's next-page link only when it points back to the same deliveries
 * endpoint, so a stored cursor cannot redirect the App's credentials elsewhere.
 */
function readNextCursor(link: string | null, apiUrl: string) {
  const next = link
    ?.split(",")
    .map((part) => /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(part)?.[1])
    .find(Boolean)
  if (!next) return null
  const url = new URL(next)
  const base = new URL(deliveriesPath, apiUrl)
  const keys = [...url.searchParams.keys()].sort()
  const cursor = url.searchParams.get("cursor")
  if (
    url.origin !== base.origin ||
    url.pathname !== base.pathname ||
    keys.join() !== "cursor,per_page" ||
    url.searchParams.get("per_page") !== pageSize ||
    !cursor ||
    cursor.length > 2048
  ) {
    throw new GitHubProviderRequestError({ cause: new Error("Unexpected deliveries link.") })
  }
  return cursor
}

/** Lists and redelivers the Hub GitHub App's webhook deliveries with an App JWT. */
export function createGitHubWebhookDeliveriesClient(
  input: GitHubWebhookDeliveriesClientInput,
  {
    apiUrl = "https://api.github.com",
    fetch: request = fetch,
    now = () => new Date(),
    timeoutMs = 10_000,
  }: GitHubWebhookDeliveriesClientOptions = {},
) {
  async function send(path: string, init: RequestInit = {}) {
    try {
      return await request(new URL(path, apiUrl), {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${await createGitHubAppJwt(input, now())}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
  }

  return {
    /** Lists one page of deliveries, newest first. */
    async listDeliveries(
      cursor: string | null,
    ): Promise<{ deliveries: GitHubWebhookDeliveryAttempt[]; nextCursor: string | null }> {
      const query = new URLSearchParams({ per_page: pageSize })
      if (cursor) query.set("cursor", cursor)
      const response = await send(`${deliveriesPath}?${query}`)
      if (!response.ok) throw new GitHubProviderRequestError()
      const body = deliveriesSchema.safeParse(await response.json().catch(() => undefined))
      if (!body.success) throw new GitHubProviderRequestError({ cause: body.error })
      return {
        deliveries: body.data.map((delivery) => ({
          id: delivery.id,
          guid: delivery.guid,
          deliveredAt: new Date(delivery.delivered_at),
          statusCode: delivery.status_code ?? 0,
          event: delivery.event,
          installationId: delivery.installation_id ?? null,
        })),
        nextCursor: readNextCursor(response.headers.get("link"), apiUrl),
      }
    },

    /** Asks GitHub to send a delivery again. Unavailable means GitHub no longer has it. */
    async redeliver(deliveryId: number): Promise<"requested" | "unavailable"> {
      const response = await send(`${deliveriesPath}/${deliveryId}/attempts`, { method: "POST" })
      if (response.status === 202) return "requested"
      if (response.status === 404 || response.status === 410) return "unavailable"
      throw new GitHubProviderRequestError()
    },
  }
}
