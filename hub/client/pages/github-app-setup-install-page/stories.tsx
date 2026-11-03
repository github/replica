import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupInstallPage } from "."

const meta = {
  title: "Hub/Pages/GitHub Setup/Installed",
  component: GithubAppSetupInstallPage,
  args: {
    data: {
      description: "The private GitHub App is ready to install on prototype repositories.",
      heading: "Replica Hub is connected",
      pageTitle: "GitHub connected",
      productName: "Replica Hub",
      nextPath: "/settings/github",
      nextLabel: "GitHub App",
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupInstallPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const InstallationRequired: Story = {
  args: {
    data: {
      ...meta.args.data,
      pageTitle: "Install GitHub App",
      heading: "Install the GitHub App",
      submitPath: "/settings/github/installed",
      submitLabel: "Install GitHub App",
    },
  },
}
