import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupRegisterPage } from "."

const meta = {
  title: "Hub/Pages/GitHub Setup/Register",
  component: GithubAppSetupRegisterPage,
  args: {
    data: {
      access: "You choose whether the App can access github/prototype, github/empty, or both.",
      description: "Replica Hub uses a private GitHub App to discover and authorize prototypes.",
      heading: "Create the GitHub App",
      manifest: '{"name":"Replica Hub"}',
      manualLabel: "Create manually or connect an existing App",
      manualPath: "/setup/manual",
      pageTitle: "Create GitHub App",
      productName: "Replica Hub",
      submitLabel: "Create the App on GitHub",
      submitPath: "https://github.com/settings/apps/new",
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupRegisterPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
