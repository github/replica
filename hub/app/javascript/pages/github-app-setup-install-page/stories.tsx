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
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupInstallPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
