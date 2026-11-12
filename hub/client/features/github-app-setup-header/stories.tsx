import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupHeader } from "."

const meta = {
  title: "Hub/Features/GitHub Setup/Header",
  component: GithubAppSetupHeader,
  args: {
    data: {
      description: "Connect this Hub to repositories owned by your GitHub organization.",
      heading: "Set up Replica Hub",
      productName: "Replica Hub",
    },
  },
} satisfies Meta<typeof GithubAppSetupHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
