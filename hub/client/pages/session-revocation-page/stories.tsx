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
  description: "Sign everyone out of this Hub. People can sign in again afterward.",
  canRevoke: true,
  signedOut: false,
  scope:
    "Hub will advance the global session revision, end every active browser session, and invalidate pending sign-ins and sensitive authorizations. Product data and public links will not change.",
  ownSession:
    "Your own session (@octocat) will end too. This browser will show the result without requiring another sign-in.",
  verification:
    "Hub will ask the current session's authentication provider to verify the same account before the change.",
  counts:
    "3 active browser sessions, 2 in-flight sign-ins, and 1 pending sensitive authorization. Counts can change before confirmation.",
  emptyLabel: null,
  confirmLabel: "I understand this will end everyone's sessions, including my own.",
  submitLabel: "End all sessions",
  cancelLabel: "Cancel",
  submitPath: "/api/session-revocation/authorizations/start",
  signInLabel: "Return to sign-in",
  signInPath: "/",
}

const result: SessionRevocationPageData = {
  ...sessionRevocationData,
  heading: "All existing Hub sessions ended",
  description:
    "Your session ended with every other existing Hub session. People can sign in again to continue.",
  scope:
    "The global session revision advanced. Existing sessions and pending authentication or sensitive authorization state no longer authorize access. Product data and public links did not change.",
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
export const ProviderVerified: Story = {
  args: {
    data: {
      ...sessionRevocationData,
      authorizationId: "11111111-1111-4111-8111-111111111111",
      confirmLabel: null,
      description:
        "Your authentication provider verified this browser. Review the current counts, then end every existing Hub session or cancel without changing access.",
      submitLabel: "End all sessions now",
      submitPath: "/api/session-revocation/authorizations/continue",
      verification: "The authorization is verified and can be used once before it expires.",
    },
  },
}
export const OnlyYourSession: Story = {
  args: {
    data: {
      ...sessionRevocationData,
      counts:
        "1 active browser session, 0 in-flight sign-ins, and 0 pending sensitive authorizations.",
      emptyLabel:
        "No other active sessions or pending authorization attempts are present. Your own session will still end.",
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
