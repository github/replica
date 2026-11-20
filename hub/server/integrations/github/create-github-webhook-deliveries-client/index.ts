import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubWebhookRequestError } from "./errors.ts"
import type {
  GitHubWebhookDeliveriesClientInput,
  GitHubWebhookDeliveriesClientOptions,
  GitHubWebhookDeliveryAttempt,
} from "./types.ts"

const deliveriesPath = "/app/hook/deliveries"
const pageSize = "100"
const deliveryIdSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .refine((value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n),
])
const deliveriesSchema = z.array(
  z.looseObject({
    id: deliveryIdSchema,
    guid: z.string().max(100),
    delivered_at: z.iso.datetime({ offset: true }),
    status_code: z.number().int().nullable(),
    event: z.string().max(100),
    installation_id: z.number().int().positive().nullish(),
    repository_id: z.number().int().positive().nullish(),
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
  let url: URL
  try {
    url = new URL(next)
  } catch {
    throw new GitHubWebhookRequestError("pagination", "response")
  }
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
    throw new GitHubWebhookRequestError("pagination", "response")
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
  async function send(path: string, operation: string, init: RequestInit = {}) {
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
    } catch {
      throw new GitHubWebhookRequestError(operation, "transport")
    }
  }

  async function read<Schema extends z.ZodType>(path: string, operation: string, schema: Schema) {
    const response = await send(path, operation)
    if (!response.ok) throw new GitHubWebhookRequestError(operation, "http", response.status)
    let body: unknown
    try {
      // GitHub's int64 IDs can exceed Number's precision; retain the JSON token.
      body = JSON.parse(
        await response.text(),
        (key: string, value: unknown, context?: { source?: string }) =>
          key === "id" && typeof value === "number" && !Number.isSafeInteger(value)
            ? context?.source
            : value,
      )
    } catch {
      throw new GitHubWebhookRequestError(operation, "response", response.status)
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new GitHubWebhookRequestError(operation, "response", response.status)
    return { data: parsed.data, response }
  }

  return {
    /** Reads settings only; never returns the webhook secret or makes a test delivery. */
    async getConfiguration() {
      const { data } = await read(
        "/app/hook/config",
        "configuration",
        z.object({
          url: z.string(),
          content_type: z.string(),
          insecure_ssl: z.union([z.string(), z.number()]),
        }),
      )
      return {
        url: data.url,
        contentType: data.content_type,
        insecureSsl: String(data.insecure_ssl),
      }
    },

    async getSubscribedEvents() {
      return (await read("/app", "events", z.object({ events: z.array(z.string()) }))).data.events
    },

    /** Lists one page of deliveries, newest first. */
    async listDeliveries(
      cursor: string | null,
    ): Promise<{ deliveries: GitHubWebhookDeliveryAttempt[]; nextCursor: string | null }> {
      const query = new URLSearchParams({ per_page: pageSize })
      if (cursor) query.set("cursor", cursor)
      const { data, response } = await read(
        `${deliveriesPath}?${query}`,
        "list-deliveries",
        deliveriesSchema,
      )
      return {
        deliveries: data.map((delivery) => ({
          id: delivery.id,
          guid: delivery.guid,
          deliveredAt: new Date(delivery.delivered_at),
          statusCode: delivery.status_code ?? 0,
          event: delivery.event,
          installationId: delivery.installation_id ?? null,
          ...(delivery.repository_id ? { repositoryId: delivery.repository_id } : {}),
        })),
        nextCursor: readNextCursor(response.headers.get("link"), apiUrl),
      }
    },

    /** Asks GitHub to send a delivery again. Unavailable means GitHub no longer has it. */
    async redeliver(deliveryId: number | string): Promise<"requested" | "unavailable"> {
      if (!deliveryIdSchema.safeParse(deliveryId).success) {
        throw new TypeError("Invalid GitHub webhook delivery ID.")
      }
      const response = await send(`${deliveriesPath}/${deliveryId}/attempts`, "redeliver", {
        method: "POST",
      })
      if (response.status === 202) return "requested"
      if (response.status === 404 || response.status === 410) return "unavailable"
      throw new GitHubWebhookRequestError("redeliver", "http", response.status)
    },
  }
}
