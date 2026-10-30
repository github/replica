import type { AnalyticsDestination, AnalyticsPageData } from "@pages/analytics-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"
import { settingsRepositoryWorkspace } from "../settings-repository-workspace"

export function settingsAnalytics(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): AnalyticsPageData {
  if (!state.repository) throw new Error("Analytics needs a selected repository.")
  const repositoryId = state.repository.id
  const destinations = state.analytics.map((entry): AnalyticsDestination => {
    const configuration = entry.configuration
    const common = {
      id: String(entry.id),
      enabled: entry.enabled,
      eventTypes: configuration.eventTypes,
      deliveryFailed: false,
      path: resourcePath("/settings/analytics", search, { repositoryId, destinationId: entry.id }),
    }
    if (configuration.provider === "custom") {
      return {
        ...common,
        provider: "custom",
        region: "custom",
        name: configuration.name,
        customConfig: {
          version: 1,
          endpoint: "https://events.example.invalid/collect",
          headers: {},
          template: { mock: true },
          success_pointer: "",
          success_value: null,
          secret_names: [],
        },
      }
    }
    if (configuration.region === "custom") {
      throw new Error("A provider fixture returned an invalid custom region.")
    }
    return {
      ...common,
      provider: configuration.provider,
      region: configuration.region,
    }
  })
  return {
    ...settingsRepositoryWorkspace(workspace, state, search, "analytics"),
    simulation: true,
    readOnly: !state.session.capabilities.manageSharing,
    pageTitle: "Mock analytics",
    alert: null,
    notice: !state.session.capabilities.manageSharing
      ? "This fixture is read-only for Mona."
      : null,
    createPath: resourcePath("/settings/analytics", search, { repositoryId }),
    destinations,
    authenticationHeaders: [],
    eventTypes: [
      { value: "prototype_registered", label: "Prototype added" },
      { value: "build_published", label: "Build published" },
      { value: "review_comment_created", label: "Review comment" },
    ],
    copy: {
      heading: "Analytics",
      description:
        "Configure simulated destinations for this repository. No analytics service is connected.",
      privacy: "This mock never collects credentials, sends events, or tracks your activity.",
      destinations: "Mock destinations",
      empty: "No mock destinations. Add one to try configuration, pause and disconnect.",
      add: "Add mock destination",
      cancel: "Cancel",
      provider: "Provider simulation",
      segment: "Segment",
      mixpanel: "Mixpanel",
      custom: "Custom HTTP simulation",
      region: "Fixture region",
      us: "United States",
      eu: "European Union",
      in: "India",
      writeKey: "Not collected in this simulation",
      serviceAccountUsername: "Not collected",
      serviceAccountSecret: "Not collected",
      projectId: "Not collected",
      mixpanelHelp: "The Mixpanel fixture needs no account or credentials.",
      rotation: "This mock configuration contains no credentials.",
      eventTypes: "Sample event types",
      history: "Sample history choice",
      newEvents: "New sample events",
      retainedEvents: "Include sample history",
      historyWarning: "This choice is saved locally. No history is sent.",
      save: "Save mock configuration",
      configured: "Simulated",
      paused: "Paused",
      failed: "Needs attention",
      pause: "Pause",
      resume: "Resume",
      disconnect: "Disconnect",
      failureHelp: "The simulated destination needs attention.",
      customName: "Mock destination name",
      customEndpoint: "Synthetic endpoint",
      customEndpointHelp:
        "The fixed endpoint is events.example.invalid. No HTTP request or secret input is available.",
      customHeaders: "No custom headers in this simulation",
      customHeaderRetention: "No headers are stored.",
      customTemplate: "Synthetic body",
      customSecrets: "No secrets are collected",
      customSecretName: "Not collected",
      customSecretValue: "Not collected",
      customAddSecret: "Unavailable in mock mode",
      customSuccessPointer: "Not used",
      customSuccessValue: "Not used",
      customPreview: "Synthetic preview",
      customPreviewHelp: "No request is sent.",
      customPreviewInvalid: "Invalid sample",
      customKeepPending: "No delivery queue exists",
      customBacklogWarning: "This simulation has no delivery queue.",
      customRetryWarning: "This simulation sends no requests.",
      customEndpointExample: "https://events.example.invalid/collect",
      customTemplateExample: '{"mock":true}',
      customHeadersExample: "{}",
    },
  }
}
