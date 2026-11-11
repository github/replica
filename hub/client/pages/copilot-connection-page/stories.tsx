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
    "A Hub administrator connects Copilot once for this deployment. The operator-provided token stays outside the database.",
  emptyLabel: "Learnings stays off until a Hub administrator connects Copilot.",
  submitPath: "/settings/copilot",
  tokenLabel: null,
}

const verification =
  "Hub checks your live administrator session again after Copilot answers, before saving the change."

const connect = {
  label: "Connect Copilot",
  consequence:
    "Hub asks Copilot to verify the configured token. Later learning runs may send review comment text without reviewer identity. Usage counts toward the token owner's Copilot plan.",
  confirmLabel: "I understand and confirm connecting Copilot for this Hub.",
  verification,
}

const disconnect = {
  label: "Disconnect Copilot",
  consequence:
    "Hub stops new Copilot-backed learning work. Existing learning stores and decisions remain unchanged.",
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
  connectedBy: "@octocat connected Copilot. Membership 9b96cae1-099f-474f-bb1f-6f8ef78a4575.",
  verifiedLabel: "Copilot last answered on 2026-11-10T23:00:00.000Z.",
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
        "Set REPLICA_COPILOT_TOKEN in the deployment secret store and restart Hub before connecting.",
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
      ...data,
      refusedLabel: "Copilot refused the configured token on 2026-11-11T13:00:00.000Z.",
      connect: { ...connect, label: "Check and connect Copilot" },
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
