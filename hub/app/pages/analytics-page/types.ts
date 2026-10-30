import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

export type AnalyticsProvider = "segment" | "mixpanel" | "custom"
export type AnalyticsRegion = "us" | "eu" | "in"

interface DestinationBase {
  id: string
  enabled: boolean
  eventTypes: string[]
  deliveryFailed: boolean
  path: string
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface CustomConfig {
  version: 1
  endpoint: string
  headers: Record<string, string | { $secret: string } | { $keep: true }>
  template: JsonValue
  success_pointer: string
  success_value: string | number | boolean | null
  secret_names: string[]
}

export type AnalyticsDestination =
  | (DestinationBase & {
      provider: "segment" | "mixpanel"
      region: AnalyticsRegion
    })
  | (DestinationBase & {
      provider: "custom"
      region: "custom"
      name: string
      customConfig: CustomConfig
      failureDetail?: string
    })

export interface AnalyticsPageData extends RepositoryWorkspaceData {
  pageTitle: string
  alert: string | null
  notice: string | null
  createPath: string
  destinations: AnalyticsDestination[]
  authenticationHeaders: string[]
  eventTypes: Array<{ value: string; label: string }>
  copy: Record<
    | "heading"
    | "description"
    | "privacy"
    | "destinations"
    | "empty"
    | "add"
    | "cancel"
    | "provider"
    | "segment"
    | "mixpanel"
    | "custom"
    | "region"
    | "us"
    | "eu"
    | "in"
    | "writeKey"
    | "serviceAccountUsername"
    | "serviceAccountSecret"
    | "projectId"
    | "mixpanelHelp"
    | "rotation"
    | "eventTypes"
    | "history"
    | "newEvents"
    | "retainedEvents"
    | "historyWarning"
    | "save"
    | "configured"
    | "paused"
    | "failed"
    | "pause"
    | "resume"
    | "disconnect"
    | "failureHelp"
    | "customName"
    | "customEndpoint"
    | "customEndpointHelp"
    | "customHeaders"
    | "customHeaderRetention"
    | "customTemplate"
    | "customSecrets"
    | "customSecretName"
    | "customSecretValue"
    | "customAddSecret"
    | "customSuccessPointer"
    | "customSuccessValue"
    | "customPreview"
    | "customPreviewHelp"
    | "customPreviewInvalid"
    | "customKeepPending"
    | "customBacklogWarning"
    | "customRetryWarning"
    | "customEndpointExample"
    | "customTemplateExample"
    | "customHeadersExample",
    string
  >
}
