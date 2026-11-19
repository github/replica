import { Resolver } from "node:dns/promises"
import { Agent, request as httpsRequest } from "node:https"
import { isIP } from "node:net"

import {
  isPublicAnalyticsIp,
  parsePublicEndpoint,
  type AnalyticsPolicy,
} from "../../../utils/analytics-public-endpoint/index.ts"

export const maximumResponseBytes = 16_384

export interface AnalyticsHttpRequest {
  provider: "segment" | "mixpanel" | "custom"
  url: URL
  headers: Record<string, string>
  body: string
}

export type AnalyticsTransport = (
  request: AnalyticsHttpRequest,
  maySend: () => Promise<boolean>,
) => Promise<{ status: number; body: string } | null>

export class AnalyticsTransportError extends Error {
  constructor(readonly code: "unsafe_endpoint" | "network_error" | "response_too_large") {
    super(code)
  }
}

async function lookup(host: string) {
  const resolver = new Resolver({ timeout: 2_500, tries: 1 })
  async function noData(answer: Promise<string[]>) {
    try {
      return await answer
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException
      if (code === "ENODATA") return []
      throw error
    }
  }
  const [ipv4, ipv6] = await Promise.all([
    noData(resolver.resolve4(host)),
    noData(resolver.resolve6(host)),
  ])
  return [...ipv4, ...ipv6]
}

/** Rejects mixed answers and pins the validated public address, not just the hostname. */
export async function resolveAnalyticsAddress(
  host: string,
  resolve: (host: string) => Promise<string[]> = lookup,
) {
  const addresses = await resolve(host).catch(() => {
    throw new AnalyticsTransportError("network_error")
  })
  if (!addresses.length || addresses.some((address) => !isPublicAnalyticsIp(address))) {
    throw new AnalyticsTransportError("unsafe_endpoint")
  }
  return addresses[0]!
}

export function createAnalyticsHttpsTransport(policy: AnalyticsPolicy): AnalyticsTransport {
  return async (input, maySend) => {
    let url: URL
    try {
      url = parsePublicEndpoint(input.url.href, policy, input.provider === "custom")
    } catch {
      throw new AnalyticsTransportError("unsafe_endpoint")
    }
    const address = await resolveAnalyticsAddress(url.hostname)
    if (!(await maySend())) return null

    // A dedicated agent does not inherit the global HTTP proxy configuration or reuse sockets.
    const agent = new Agent({ keepAlive: false })
    try {
      return await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const family = isIP(address)
        const abort = AbortSignal.timeout(10_000)
        const outgoing = httpsRequest(
          url,
          {
            method: "POST",
            headers: { ...input.headers, "content-length": Buffer.byteLength(input.body) },
            agent,
            family,
            lookup: (_host, _options, callback) => callback(null, address, family),
            servername: url.hostname,
            rejectUnauthorized: true,
            maxHeaderSize: 8_192,
            signal: abort,
          },
          (response) => {
            const chunks: Buffer[] = []
            let bytes = 0
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length
              if (bytes > maximumResponseBytes) {
                reject(new AnalyticsTransportError("response_too_large"))
                response.destroy()
                outgoing.destroy()
              } else {
                chunks.push(chunk)
              }
            })
            response.on("error", () => reject(new AnalyticsTransportError("network_error")))
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            )
          },
        )
        outgoing.on("error", () => reject(new AnalyticsTransportError("network_error")))
        outgoing.end(input.body)
      })
    } finally {
      agent.destroy()
    }
  }
}
