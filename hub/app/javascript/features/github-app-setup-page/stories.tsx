import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"

import { GithubAppSetupPage } from "."

const meta = {
  title: "Hub/Features/GitHub Setup/Page",
  component: GithubAppSetupPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <GithubAppSetupPage>
      <GithubAppSetupHeader
        data={{
          description: "Connect this Hub to github/prototype.",
          heading: "Set up Replica Hub",
          productName: "Replica Hub",
        }}
      />
      <p>GitHub decides which repositories the App can access.</p>
      <Button variant="primary">Continue</Button>
    </GithubAppSetupPage>
  ),
}
