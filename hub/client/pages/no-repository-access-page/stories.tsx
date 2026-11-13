import type { Meta, StoryObj } from "@storybook/react-vite"

import { NoRepositoryAccessPage } from "."

const meta = {
  title: "Hub/Pages/Security/No repository access",
  component: NoRepositoryAccessPage,
  args: { login: "octocat" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NoRepositoryAccessPage>

export default meta
type Story = StoryObj<typeof meta>

export const SignedInAccount: Story = {}
export const UnknownAccount: Story = { args: { login: null } }
