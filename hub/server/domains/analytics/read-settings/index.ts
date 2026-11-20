import { hkdfSync } from "node:crypto"

import { isPublicDnsName } from "../../../utils/analytics-public-endpoint/index.ts"
import type { AnalyticsSettings } from "../types.ts"

export function readAnalyticsSettings(
  environment: NodeJS.ProcessEnv,
  allowLocalFallback = false,
): AnalyticsSettings | undefined {
  const dedicatedKey = environment.HUB_ANALYTICS_ENCRYPTION_KEY?.trim()
  const outboundEnabled = environment.HUB_ANALYTICS_OUTBOUND_ENABLED === "true"
  const allowRetainedExport = environment.HUB_ANALYTICS_ALLOW_RETAINED_EXPORT === "true"
  if (!dedicatedKey && (outboundEnabled || allowRetainedExport)) {
    throw new Error(
      "HUB_ANALYTICS_ENCRYPTION_KEY must be configured before enabling analytics exports.",
    )
  }
  const rawKey =
    dedicatedKey || (allowLocalFallback ? environment.HUB_AUTHENTICATION_ENCRYPTION_KEY : undefined)
  if (!rawKey) return undefined
  const key = Buffer.from(rawKey, "base64")
  if (key.length !== 32) throw new Error("HUB_ANALYTICS_ENCRYPTION_KEY must decode to 32 bytes.")
  const applicationOrigin = environment.HUB_APPLICATION_ORIGIN
  if (!applicationOrigin) throw new Error("Analytics requires HUB_APPLICATION_ORIGIN.")
  const configuredHosts = environment.REPLICA_ANALYTICS_OUTBOUND_HOSTS
  const hosts = configuredHosts?.split(",").map((host) => host.trim().toLowerCase())
  if (hosts?.some((host) => !isPublicDnsName(host))) {
    throw new Error("REPLICA_ANALYTICS_OUTBOUND_HOSTS must contain only public DNS hostnames.")
  }
  return {
    applicationOrigin,
    encryptionKey: Buffer.from(hkdfSync("sha256", key, "", "replica analytics destination v1", 32)),
    allowRetainedExport,
    outboundEnabled,
    policy: {
      hubHosts: [applicationOrigin, environment.HUB_PREVIEW_ORIGIN]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => new URL(origin).hostname),
      outboundHosts: hosts ? new Set(hosts) : undefined,
    },
  }
}
