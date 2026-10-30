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
export const SimulationPending: Story = {
  args: {
    data: {
      ...meta.args.data,
      simulation: true,
      heading: "Simulate App installation",
      description:
        "The App and installation identifiers are synthetic. No external App or repository changed.",
      submitPath: "/settings/github/installed",
      submitLabel: "Simulate installation",
      nextPath: "/settings/github",
      nextLabel: "Review mock App",
    },
  },
}
export const SimulationComplete: Story = {
  args: {
    data: {
      ...SimulationPending.args!.data!,
      heading: "Mock installation complete",
      submitPath: undefined,
      submitLabel: undefined,
    },
  },
}
