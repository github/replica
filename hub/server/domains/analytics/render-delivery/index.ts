import type { AnalyticsEvent } from "../../../generated/prisma/client.ts"
import {
  maximumResponseBytes,
  type AnalyticsHttpRequest,
} from "../../../integrations/analytics-https/send-request/index.ts"
import { maximumRequestBytes } from "../constants.ts"
import type { DestinationConfiguration, JsonValue } from "../types.ts"

const segmentHosts = { us: "api.segment.io", eu: "events.eu1.segmentapis.com" }
const mixpanelHosts = {
  us: "api.mixpanel.com",
  eu: "api-eu.mixpanel.com",
  in: "api-in.mixpanel.com",
}

function basic(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`
}

function evaluate(
  node: JsonValue,
  fields: Record<string, JsonValue>,
  secrets: Record<string, string>,
): JsonValue {
  if (Array.isArray(node)) return node.map((item) => evaluate(item, fields, secrets))
  if (node !== null && typeof node === "object") {
    if (typeof node.$field === "string" && Object.hasOwn(fields, node.$field)) {
      return fields[node.$field] ?? node.when_missing ?? null
    }
    if (typeof node.$secret === "string" && Object.hasOwn(secrets, node.$secret)) {
      return secrets[node.$secret]!
    }
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => [key, evaluate(child, fields, secrets)]),
    )
  }
  return node
}

export function renderAnalyticsDelivery(
  event: AnalyticsEvent,
  configuration: DestinationConfiguration,
): AnalyticsHttpRequest | null {
  const { provider } = configuration
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "x-replica-event-id": event.id,
  }
  const properties = {
    repository_id: event.repositoryId,
    prototype_id: event.prototypeId,
    ...(event.buildId ? { build_id: event.buildId } : {}),
    ...(event.threadId ? { thread_id: event.threadId } : {}),
    ...(event.commentId ? { comment_id: event.commentId } : {}),
  }
  const occurredAt = event.occurredAt.toISOString()
  const anonymousId = `system/${event.id}`
  let url: URL
  let payload: JsonValue
  if (provider === "segment") {
    url = new URL(`https://${segmentHosts[configuration.region]}/v1/track`)
    headers.authorization = basic(configuration.writeKey, "")
    payload = {
      event: event.eventName,
      messageId: event.id,
      timestamp: occurredAt,
      anonymousId,
      properties,
    }
  } else if (provider === "mixpanel") {
    url = new URL(`https://${mixpanelHosts[configuration.region]}/import`)
    url.searchParams.set("strict", "1")
    url.searchParams.set("project_id", configuration.projectId)
    headers.authorization = basic(
      configuration.serviceAccountUsername,
      configuration.serviceAccountSecret,
    )
    payload = [
      {
        event: event.eventName,
        properties: {
          ...properties,
          time: Math.floor(event.occurredAt.getTime() / 1_000),
          distinct_id: anonymousId,
          actor_type: "system",
          $insert_id: event.id,
          ip: 0,
        },
      },
    ]
  } else {
    url = new URL(configuration.endpoint)
    for (const [name, value] of Object.entries(configuration.headers)) {
      headers[name] = typeof value === "string" ? value : configuration.secrets[value.$secret]!
    }
    payload = evaluate(
      configuration.template,
      {
        ...properties,
        build_id: event.buildId,
        thread_id: event.threadId,
        comment_id: event.commentId,
        actor_id: null,
        event_id: event.id,
        event_name: event.eventName,
        occurred_at: occurredAt,
        properties,
      },
      configuration.secrets,
    )
    // Missing optional IDs are intentionally available only through their template fallbacks.
  }
  const body = JSON.stringify(payload)
  return Buffer.byteLength(body) <= maximumRequestBytes ? { provider, url, headers, body } : null
}

export function analyticsResponseFailure(
  configuration: DestinationConfiguration,
  { status, body }: { status: number; body: string },
) {
  if (Buffer.byteLength(body) > maximumResponseBytes)
    return { code: "response_too_large", retryable: false }
  if (status >= 300 && status < 400) return { code: "http_redirect", retryable: false }
  if (status === 408 || status === 429)
    return { code: status === 429 ? "rate_limited" : "network_error", retryable: true }
  if (status >= 500) return { code: "server_error", retryable: true }
  if (status < 200 || status >= 300) return { code: "http_rejected", retryable: false }
  if (configuration.provider === "custom" && !configuration.successPointer) return null

  const mismatch = { code: "response_mismatch", retryable: false }
  try {
    const bodyValue: unknown = JSON.parse(body)
    if (configuration.provider === "custom") {
      let value = bodyValue
      for (const segment of configuration.successPointer.split("/").slice(1)) {
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~")
        if (
          value === null ||
          typeof value !== "object" ||
          !Object.hasOwn(value, key) ||
          (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key))
        )
          return mismatch
        value = (value as Record<string, unknown>)[key]
      }
      return value === configuration.successValue ? null : mismatch
    }
    if (typeof bodyValue !== "object" || bodyValue === null || Array.isArray(bodyValue))
      return mismatch
    const response = bodyValue as Record<string, unknown>
    return configuration.provider === "segment"
      ? response.success === true
        ? null
        : mismatch
      : response.status === "OK" && response.num_records_imported === 1
        ? null
        : mismatch
  } catch {
    return mismatch
  }
}
