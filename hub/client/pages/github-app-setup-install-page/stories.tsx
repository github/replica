import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupInstallPage } from "."

const meta = {
  title: "Hub/Design/Legacy GitHub App/Installation",
  component: GithubAppSetupInstallPage,
  args: {
    data: {
      description:
        "Design reference only. Hub no longer starts a GitHub App install from this page.",
      heading: "Install the GitHub App",
      pageTitle: "Install GitHub App",
      productName: "Replica Hub",
      canContinue: false,
      submitPath: "#",
      submitLabel: "Install GitHub App",
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupInstallPage>

export default meta
type Story = StoryObj<typeof meta>

export const DesignReference: Story = {}
