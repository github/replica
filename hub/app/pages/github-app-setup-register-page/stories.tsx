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
export const Simulation: Story = {
  args: {
    data: {
      ...meta.args.data,
      simulation: true,
      heading: "Register the mock App",
      description: "No App is created on GitHub. This advances one local fixture record.",
      access:
        "The fixture refers to github/prototype and github/empty. No repository access is requested or granted.",
      manifest: '{"name":"Replica Hub mock","mock":true}',
      submitLabel: "Register simulation",
      submitPath: "/settings/github/register",
    },
  },
}
