import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { FreshAuthorizationPage } from "."

const meta = {
  title: "Hub/Pages/Security/Fresh authorization",
  component: FreshAuthorizationPage,
  parameters: { layout: "fullscreen" },
  args: {
    data: {
      productName: "Replica Hub",
      pageTitle: "Fresh GitHub authorization required",
      heading: "Fresh GitHub authorization required",
      description:
        "Verify the same GitHub account to continue your confirmed action. GitHub may reuse your signed-in browser; this is not a guaranteed password or MFA challenge.",
      submitLabel: "Verify with GitHub",
      submitPath: "/authorization/example",
      cancelLabel: "Cancel",
      cancelPath: "/authorization/example",
      authenticityToken: "storybook-token",
    },
  },
} satisfies Meta<typeof FreshAuthorizationPage>

export default meta
type Story = StoryObj<typeof meta>

export const Required: Story = {}
export const HubAdministratorChange: Story = {
  args: {
    data: {
      ...meta.args.data,
      administrationWorkspace: hubAdministrationWorkspaceData,
      description:
        "Verify the same GitHub account to continue the Hub administrator role change you confirmed.",
    },
  },
}
export const Continuing: Story = {
  args: {
    data: {
      ...meta.args.data,
      administrationWorkspace: hubAdministrationWorkspaceData,
      pageTitle: "Completing your action",
      heading: "Completing your action",
      description:
        "GitHub verified your account. Hub is continuing the action you confirmed. If it does not continue automatically, choose Continue.",
      submitLabel: "Continue",
      submitPath: "/hub_admins",
      continuation: { id: "example", method: "post" },
    },
  },
}
