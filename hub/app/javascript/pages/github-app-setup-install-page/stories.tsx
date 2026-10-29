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

export const ManualConnection: Story = {
  args: {
    data: {
      ...meta.args.data,
      description:
        "The App and approved installation are connected. Enroll a Hub operator at /operator/enrollment, verify GitHub sign-in, and check a supported webhook delivery. Connection does not verify the OAuth client secret or webhook delivery.",
    },
  },
}
