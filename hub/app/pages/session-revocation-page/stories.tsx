import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  authenticatedHubWorkspaceData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { SessionRevocationPage } from "."
import type { SessionRevocationPageData } from "./types"

export const sessionRevocationData: SessionRevocationPageData = {
  ...hubAdministrationData,
  administrationWorkspace: {
    ...hubAdministrationData.administrationWorkspace,
    selectedSection: "sessions",
  },
  githubAppPath: null,
  sessionRevocationPath: null,
  pageTitle: "End all Hub sessions",
  heading: "End all Hub sessions",
  description:
    "Sign everyone out of this Hub and disconnect existing Copilot canvas connections. People can sign in and approve new connections afterward.",
  canRevoke: true,
  signedOut: false,
  scope:
    "Existing browser sessions, canvas access and refresh credentials, pending canvas approvals, preview handoffs, and signed-in preview access will end. Public share links and public previews will not change.",
  ownSession:
    "Your own session (@octocat) will end too. This browser will show the result without requiring another sign-in.",
  verification:
    "GitHub must have verified this browser's account within the last five minutes. If verification is required, Hub ends the sessions after it succeeds.",
  counts:
    "3 browser sessions, 2 canvas connections, and 1 pending approval. Counts can change before confirmation.",
  emptyLabel: null,
  confirmLabel: "I understand this will end everyone's sessions, including my own.",
  submitLabel: "End all sessions",
  cancelLabel: "Cancel",
  submitPath: "/session_revocation",
  signInLabel: "Return to sign-in",
  signInPath: "/",
}

const result: SessionRevocationPageData = {
  ...sessionRevocationData,
  heading: "All existing Hub sessions ended",
  description:
    "Your session has ended. Existing browser sessions, canvas access and refresh credentials, pending approvals, and signed-in preview handoffs no longer authorize access. Sign in again to continue.",
  scope:
    "Public share links and public previews have not changed. People can sign in and approve new canvas connections.",
  canRevoke: false,
  signedOut: true,
  administrationWorkspace: null,
  authenticatedWorkspace: null,
  auditPath: null,
  githubAppPath: null,
  sessionRevocationPath: null,
  ownSession: null,
  counts: null,
}

const meta = {
  title: "Hub/Pages/Security/End all sessions",
  component: SessionRevocationPage,
  excludeStories: ["sessionRevocationData"],
  parameters: { layout: "fullscreen" },
  args: { data: sessionRevocationData },
} satisfies Meta<typeof SessionRevocationPage>

export default meta
type Story = StoryObj<typeof meta>

export const Confirmation: Story = {}
export const OnlyYourSession: Story = {
  args: {
    data: {
      ...sessionRevocationData,
      counts: "1 browser session, 0 canvas connections, and 0 pending approvals.",
      emptyLabel:
        "No other browser sessions, canvas connections, or pending approvals are active. Your own session will still end.",
    },
  },
}
export const Denied: Story = {
  args: {
    data: {
      ...sessionRevocationData,
      canRevoke: false,
      administrationWorkspace: null,
      authenticatedWorkspace: authenticatedHubWorkspaceData,
      auditPath: null,
      hubAdminsPath: null,
      sharingSettingsPath: null,
      counts: null,
      alert: "Only a current Hub administrator can end all sessions. No sessions were ended.",
    },
  },
}
export const Ended: Story = { args: { data: result } }
export const SimulatedConfirmation: Story = {
  args: {
    data: {
      ...sessionRevocationData,
      simulation: true,
      heading: "End this mock browser session?",
      description:
        "Only this tab's in-memory profile changes. Real sessions, other browsers and share links are untouched.",
      scope:
        "The current synthetic browser profile signs out. No credentials or external connections exist.",
      ownSession: "@octocat will be signed out of this simulation.",
      verification: "No identity provider is contacted.",
      counts: "1 mock browser session. No real sessions are counted.",
      confirmLabel: "I understand this ends only the current mock browser session.",
      submitLabel: "End mock browser session",
      submitPath: "/settings/sessions",
    },
  },
}
export const SimulatedEnded: Story = {
  args: {
    data: {
      ...result,
      simulation: true,
      heading: "Mock browser session ended",
      description: "Real sessions, other browsers and share links are untouched.",
      scope: "Only this tab's in-memory mock profile changed.",
      notice: "The mock session ended. Use the mock profile controls to start again.",
    },
  },
}
export const DisconnectDeliveryFailed: Story = {
  args: {
    data: {
      ...result,
      alert:
        "Credentials were revoked, but Hub could not deliver every live disconnect. Existing connections cannot authorize new subscriptions or receive review updates; periodic checks also close them. Ask the deployment operator to check the live connection service.",
    },
  },
}
