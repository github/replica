import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupShowPage } from "."

const meta = {
  title: "Hub/Pages/GitHub Setup/Bootstrap",
  component: GithubAppSetupShowPage,
  args: {
    data: {
      authenticityToken: "storybook-token",
      description:
        "Enter the deployment bootstrap secret to create or connect this Hub's GitHub App.",
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
