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
export const Simulation: Story = {
  args: {
    data: {
      ...meta.args.data,
      simulation: true,
      canContinue: true,
      heading: "Simulate GitHub App setup",
      description:
        "Create a local synthetic App record. No bootstrap secret, account or provider connection is used.",
      organizationLabel: "Synthetic organization",
      organizationHint: "github is a fixed fixture identifier, not a connected organization.",
      submitLabel: "Continue mock setup",
      submitPath: "/settings/github/setup",
    },
  },
}
