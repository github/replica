import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupShowPage } from "."

const meta = {
  title: "Hub/Pages/GitHub Setup/Bootstrap",
  component: GithubAppSetupShowPage,
  args: {
    data: {
      authenticityToken: "storybook-token",
      description: "Connect a private GitHub App owned by your organization or personal account.",
      heading: "Connect GitHub",
      organizationHint: "Leave blank to create the App for your personal account.",
      organizationLabel: "Organization",
      pageTitle: "Set up Replica Hub",
      productName: "Replica Hub",
      secretLabel: "Bootstrap secret",
      submitLabel: "Continue",
      submitPath: "/github_app_setup",
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupShowPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
