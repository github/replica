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
        "Verify the same GitHub account before changing sensitive settings. GitHub may reuse your signed-in browser; this is not a guaranteed password or MFA challenge.",
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
        "Verify the same GitHub account before changing a Hub administrator role. Return to the confirmation page and submit again. No role change is saved or replayed.",
    },
  },
}
export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: "24rem", maxWidth: "100%" }}>
      <FreshAuthorizationPage {...args} />
    </div>
  ),
}
