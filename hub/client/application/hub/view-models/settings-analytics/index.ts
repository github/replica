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
          endpoint: "https://events.example.com/collect",
          headers: {},
          template: {
            event: { $field: "event_name" },
            event_id: { $field: "event_id" },
            properties: { $field: "properties" },
          },
          success_pointer: "",
          success_value: null,
          secret_names: [],
        },
      }
    }
    if (configuration.region === "custom") {
      throw new Error("The analytics provider returned an invalid custom region.")
    }
    return {
      ...common,
      provider: configuration.provider,
      region: configuration.region,
    }
  })
  return {
    ...settingsRepositoryWorkspace(workspace, state, search, "analytics"),
    readOnly: !state.session.capabilities.manageSharing,
    pageTitle: "Analytics",
    alert: null,
    notice: !state.session.capabilities.manageSharing
      ? "You can view analytics destinations, but you do not have permission to change them."
      : null,
    createPath: resourcePath("/settings/analytics", search, { repositoryId }),
    destinations,
    authenticationHeaders: ["authorization", "x-api-key", "x-auth-token", "api-key"],
    eventTypes: [
      { value: "prototype_registered", label: "Prototype added to gallery" },
      { value: "build_published", label: "Subsequent successful Build published" },
      { value: "review_comment_created", label: "Review conversation started" },
    ],
    copy: {
      heading: "Analytics",
      description:
        "Hub records repository activity for 90 days, even without a destination. Send selected events to your analytics provider.",
      privacy:
        "Events contain identifiers and timestamps, never comment text or prototype content. Opaque person identifiers are consistent across this Hub. No offline or local editing activity is tracked.",
      destinations: "Destinations",
      empty: "No destinations configured. Hub is still recording events.",
      add: "Add destination",
      cancel: "Cancel",
      provider: "Provider",
      segment: "Segment",
      mixpanel: "Mixpanel",
      custom: "Custom HTTP",
      region: "Region",
      us: "United States",
      eu: "European Union",
      in: "India",
      writeKey: "Source write key",
      serviceAccountUsername: "Service account username",
      serviceAccountSecret: "Service account secret",
      projectId: "Project ID",
      mixpanelHelp:
        "Use a Mixpanel Owner or Admin service account authorized for this project. Hub sends one event at a time through the strict import API.",
      rotation:
        "Credentials are never displayed. Leave a field blank to keep its saved value, or enter a replacement.",
      eventTypes: "Events to send",
      history: "When should delivery begin?",
      newEvents: "New events only",
      retainedEvents: "Include retained events from the last 90 days",
      historyWarning:
        "Including retained events sends this repository's selected event types to the provider. They may appear in reports.",
      save: "Save configuration",
      configured: "Configured",
      paused: "Paused",
      failed: "Needs attention",
      pause: "Pause",
      resume: "Resume",
      disconnect: "Disconnect",
      failureHelp: "Hub couldn't send some activity. Check your provider settings below.",
      customName: "Destination name",
      customEndpoint: "Public HTTPS URL",
      customEndpointHelp:
        "Use a public DNS name on port 443. Query settings are visible and cannot hold credentials. Hub never follows redirects.",
      customHeaders: "Headers (JSON object)",
      customHeaderRetention:
        'A saved static header appears as {"$keep":true}. Leave it unchanged to keep its value for that header name; the saved value is never shown.',
      customTemplate: "Request body (JSON template)",
      customSecrets: "Encrypted secrets",
      customSecretName: "Secret name",
      customSecretValue: "Secret value",
      customAddSecret: "Add secret",
      customSuccessPointer: "Success response field (JSON Pointer, optional)",
      customSuccessValue: "Expected JSON value",
      customPreview: "Redacted sample request body",
      customPreviewHelp:
        "Sample identifiers are made up; no request is sent. Secret references appear as redacted values.",
      customPreviewInvalid: "Preview unavailable. Check the JSON body.",
      customKeepPending: "Same recipient; keep pending events after changing authentication",
      customBacklogWarning:
        "Changing the URL or request body cancels unsent events. Changing authentication also cancels them unless you confirm the same recipient. To resend retained history, disconnect and add a new destination with retained events selected.",
      customRetryWarning:
        "Hub retries some failures with the same event ID in a header. A successful HTTP response does not prove an event appeared in reports, and the receiving service may not deduplicate retries.",
      customEndpointExample: "https://events.example.com/collect?version=1",
      customTemplateExample:
        '{"event":{"$field":"event_name"},"event_id":{"$field":"event_id"},"properties":{"$field":"properties"}}',
      customHeadersExample: '{"Authorization":{"$secret":"api_token"}}',
    },
  }
}
