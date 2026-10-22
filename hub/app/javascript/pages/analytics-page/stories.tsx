import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { AnalyticsPage } from "."
import type { AnalyticsDestination, AnalyticsPageData } from "./types"

const destination: AnalyticsDestination = {
  id: "1",
  provider: "segment",
  region: "us",
  enabled: true,
  eventTypes: ["prototype_registered"],
  deliveryFailed: false,
  path: "/repositories/2001/analytics/destinations/1",
}

const customDestination: AnalyticsDestination = {
  id: "3",
  provider: "custom",
  region: "custom",
  name: "Product events",
  enabled: true,
  eventTypes: ["prototype_registered", "build_published"],
  deliveryFailed: false,
  path: "/repositories/2001/analytics/destinations/3",
  customConfig: {
    version: 1,
    endpoint: "https://events.example.com/collect",
    headers: {
      Authorization: { $secret: "api_token" },
      "X-Workspace": { $keep: true },
    },
    template: {
      event: { $field: "event_name" },
      event_id: { $field: "event_id" },
      properties: { $field: "properties" },
      credential: { $secret: "api_token" },
    },
    success_pointer: "/accepted",
    success_value: true,
    secret_names: ["api_token"],
  },
}

const data: AnalyticsPageData = {
  ...authenticatedHeaderData,
  analyticsLabel: "Analytics",
  analyticsPath: "/repositories/2001/analytics",
  securityAuditLabel: "Security audit",
  securityAuditPath: "/repositories/2001/security_audit",
  alert: null,
  notice: null,
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  navigationLabel: "Repository navigation",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  pageTitle: "Analytics",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [githubPrototype, githubEmpty],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
  selectedSection: "analytics",
  createPath: "/repositories/2001/analytics/destinations",
  destinations: [],
  authenticationHeaders: ["authorization", "x-api-key", "x-auth-token", "api-key"],
  eventTypes: [
    { value: "prototype_registered", label: "Prototype added to gallery" },
    { value: "prototype_first_published", label: "First successful Build published" },
    { value: "build_published", label: "Subsequent successful Build published" },
    { value: "review_comment_created", label: "Review conversation started" },
    { value: "review_reply_added", label: "Reply added" },
    { value: "review_thread_resolved", label: "Conversation resolved" },
    { value: "review_thread_reopened", label: "Conversation reopened" },
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

const meta = {
  title: "Hub/Pages/Repositories/Analytics",
  component: AnalyticsPage,
  args: { data },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AnalyticsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Configured: Story = { args: { data: { ...data, destinations: [destination] } } }
export const Paused: Story = {
  args: { data: { ...data, destinations: [{ ...destination, enabled: false }] } },
}
export const Failed: Story = {
  args: { data: { ...data, destinations: [{ ...destination, deliveryFailed: true }] } },
}
export const Multiple: Story = {
  args: {
    data: {
      ...data,
      destinations: [
        destination,
        {
          ...destination,
          id: "2",
          provider: "mixpanel",
          region: "eu",
          path: "/repositories/2001/analytics/destinations/2",
        },
      ],
    },
  },
}
export const CustomConfigured: Story = {
  args: { data: { ...data, destinations: [customDestination] } },
}
export const CustomMultiple: Story = {
  args: {
    data: {
      ...data,
      destinations: [
        destination,
        customDestination,
        {
          ...customDestination,
          id: "4",
          name: "Build archive",
          path: "/repositories/2001/analytics/destinations/4",
          customConfig: {
            ...customDestination.customConfig,
            endpoint: "https://archive.example.com/events",
          },
        },
      ],
    },
  },
}
export const CustomFailed: Story = {
  args: {
    data: {
      ...data,
      destinations: [
        {
          ...customDestination,
          deliveryFailed: true,
          failureDetail: "The response did not match the configured confirmation field and value.",
        },
      ],
    },
  },
}
export const CustomInvalid: Story = {
  args: {
    data: {
      ...data,
      alert: "Could not save the custom destination. Check its public HTTPS URL and JSON body.",
      destinations: [customDestination],
    },
  },
  play: async ({ canvas, userEvent }) => {
    const body = canvas.getByRole("textbox", { name: data.copy.customTemplate })
    await userEvent.clear(body)
    await userEvent.type(body, "invalid JSON")
  },
}
