import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupRegisterPage } from "."

const meta = {
  title: "Hub/Design/Legacy GitHub App/Manual registration",
  component: GithubAppSetupRegisterPage,
  args: {
    data: {
      access: "You choose whether the App can access github/prototype, github/empty, or both.",
      description:
        "Design reference only. Hub no longer submits a manifest to GitHub from this page.",
      heading: "Create the GitHub App",
      manifest: "",
      pageTitle: "Create GitHub App",
      productName: "Replica Hub",
      canContinue: false,
      submitLabel: "Create the App on GitHub",
      submitPath: "#",
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupRegisterPage>

export default meta
type Story = StoryObj<typeof meta>

export const DesignReference: Story = {}
