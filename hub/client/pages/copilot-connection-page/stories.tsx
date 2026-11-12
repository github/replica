import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  authenticatedHubWorkspaceData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { CopilotConnectionPage } from "."
import type { CopilotConnectionPageData } from "./types"

type AvailableData = Extract<CopilotConnectionPageData, { accessDenied: false }>

const shared = {
  ...hubAdministrationData,
  administrationWorkspace: {
    ...hubAdministrationData.administrationWorkspace,
    selectedSection: "copilot" as const,
  },
  heading: "Copilot",
  description:
    "A Hub administrator connects Copilot once for the whole Hub. Hub then asks Copilot to suggest learnings from prototype review comments, with a token that the person who runs Hub provides, so it works while everyone is signed out.",
  emptyLabel: "Learnings stays off until a Hub administrator connects Copilot.",
  submitPath: "/copilot",
  tokenLabel: null,
}

const verification =
  "This change requires GitHub verification within the last five minutes on this browser. If verification is required, Hub continues your confirmed change after it succeeds."

const connect = {
  label: "Connect Copilot",
  consequence:
    "Hub will ask Copilot, with the configured token, to read new review comments from every repository on this Hub and suggest learnings, including while you are signed out. Copilot never sees who wrote a comment. The usage counts toward the Copilot plan of the token's owner. Hub checks the token with Copilot first, and never stores or shows it.",
  confirmLabel: "I understand that Hub will use this Copilot token for this Hub.",
  verification,
}

const disconnect = {
  label: "Disconnect Copilot",
  consequence:
    "Hub stops looking for learnings and turns off Learnings for every repository. Hub keeps every learning and decision, so connecting again restores them. The token stays where the person who runs Hub keeps it; they can revoke it on GitHub.",
  confirmLabel: "I understand and confirm disconnecting Copilot for this Hub.",
  verification,
}

const data: CopilotConnectionPageData = {
  ...shared,
  accessDenied: false,
  connected: false,
  statusLabel: "Copilot is not connected",
  connect,
}

const connected: AvailableData = {
  ...shared,
  accessDenied: false,
  connected: true,
  statusLabel: "Copilot is connected",
  connectedBy: "@octocat connected Copilot on October 9, 2026.",
  verifiedLabel: "Copilot last answered on October 10, 2026.",
  usageLabel: "In the last 30 days, Learnings used 0.147 AI credits in 2 Copilot requests.",
  refusedLabel: null,
  connect: null,
  disconnect,
}

const meta = {
  title: "Hub/Pages/Security/Copilot",
  component: CopilotConnectionPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof CopilotConnectionPage>

export default meta
type Story = StoryObj<typeof meta>

export const NotConnected: Story = {}
export const NoToken: Story = {
  args: {
    data: {
      ...data,
      tokenLabel:
        "Hub has no Copilot token. The person who runs Hub sets REPLICA_COPILOT_TOKEN to a fine-grained personal access token whose only permission is Copilot requests, then restarts Hub.",
      connect: null,
    },
  },
}
export const Connected: Story = {
  args: { data: { ...connected, notice: "Copilot is connected." } },
}
export const Refused: Story = {
  args: {
    data: {
      ...connected,
      refusedLabel:
        "Copilot refused the token on October 11, 2026, so Hub stopped looking for learnings. Replace REPLICA_COPILOT_TOKEN and restart Hub, or check the token again.",
      connect: { ...connect, label: "Check the token again" },
    },
  },
}
export const AccessRemoved: Story = {
  args: {
    data: {
      ...hubAdministrationData,
      heading: shared.heading,
      description: shared.description,
      accessDenied: true,
      administrationWorkspace: null,
      authenticatedWorkspace: { ...authenticatedHubWorkspaceData, selectedSection: "copilot" },
      auditPath: null,
      hubAdminsPath: null,
      sharingSettingsPath: null,
      githubAppPath: null,
      copilotConnectionPath: null,
      sessionRevocationPath: null,
      emptyLabel: "Only Hub administrators can view or change the Copilot connection.",
      alert: "Your account is not a current Hub administrator. Copilot was not changed.",
    },
  },
}
