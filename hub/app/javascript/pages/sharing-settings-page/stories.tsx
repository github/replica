import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  authenticatedHubWorkspaceData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { SharingSettingsPage } from "."
import type { SharingSettingsPageData } from "./types"

const data: SharingSettingsPageData = {
  ...hubAdministrationData,
  administrationWorkspace: {
    ...hubAdministrationData.administrationWorkspace,
    selectedSection: "sharing",
  },
  heading: "Public sharing",
  description:
    "Control anonymous access to shared prototype Builds. This setting does not grant repository access.",
  accessDenied: false,
  statusLabel: "Public sharing is disabled",
  emptyLabel: "No public access is permitted until a Hub administrator explicitly enables sharing.",
  operation: "enable",
  submitPath: "/sharing_settings",
  submitLabel: "Enable public sharing",
  consequence:
    "Anyone with a new share link can view its fixed Build without signing in. Previously revoked links stay revoked.",
  confirmLabel: "I understand and confirm this deployment-wide change.",
  verification:
    "This change requires GitHub verification within the last five minutes on this browser. If asked to verify, return and confirm again. Verification never submits this change.",
}

const meta = {
  title: "Hub/Pages/Security/Public sharing",
  component: SharingSettingsPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof SharingSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Disabled: Story = {}
export const DisableConfirmation: Story = {
  args: {
    data: {
      ...data,
      statusLabel: "Public sharing is enabled",
      operation: "disable",
      submitLabel: "Disable public sharing",
      consequence:
        "All existing share links will be permanently revoked, including open previews and pending handoffs. Enabling later permits new links only.",
    },
  },
}
export const FreshChallenge: Story = {
  args: {
    data: {
      ...data,
      alert:
        "Fresh GitHub authorization is required. No changes were made. Verify your account, then submit the action again.",
    },
  },
}
export const AccessRemoved: Story = {
  args: {
    data: {
      ...hubAdministrationData,
      heading: data.heading,
      description: data.description,
      accessDenied: true,
      administrationWorkspace: null,
      authenticatedWorkspace: { ...authenticatedHubWorkspaceData, selectedSection: "sharing" },
      auditPath: null,
      hubAdminsPath: null,
      sharingSettingsPath: null,
      githubAppPath: null,
      sessionRevocationPath: null,
      emptyLabel: "Only Hub administrators can view or change deployment sharing settings.",
      alert: "Your account is not a current Hub administrator. No sharing settings changed.",
    },
  },
}
