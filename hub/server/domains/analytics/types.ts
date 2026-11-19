import type { AnalyticsEventName, AnalyticsProvider } from "../../generated/prisma/client.ts"
import type { AnalyticsPolicy } from "../../utils/analytics-public-endpoint/index.ts"

export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
export type CustomHeader = string | { $secret: string }

export type DestinationConfiguration =
  | { provider: "segment"; region: "us" | "eu"; writeKey: string }
  | {
      provider: "mixpanel"
      region: "us" | "eu" | "in"
      serviceAccountUsername: string
      serviceAccountSecret: string
      projectId: string
    }
  | {
      provider: "custom"
      name: string
      endpoint: string
      headers: Record<string, CustomHeader>
      template: JsonValue
      secrets: Record<string, string>
      successPointer: string
      successValue: JsonScalar
    }

export type CustomConfiguration = Extract<DestinationConfiguration, { provider: "custom" }>

export interface AnalyticsSettings {
  encryptionKey: Buffer
  applicationOrigin: string
  policy: AnalyticsPolicy
  allowRetainedExport: boolean
  outboundEnabled: boolean
}

export interface DestinationInput {
  provider: AnalyticsProvider
  eventTypes: AnalyticsEventName[]
  configuration: unknown
  includeRetained?: boolean
}
