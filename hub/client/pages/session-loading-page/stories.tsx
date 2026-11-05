import type { Meta, StoryObj } from "@storybook/react-vite"

import { SessionLoadingPage } from "."

const meta = {
  title: "Hub/Pages/Security/Session loading",
  component: SessionLoadingPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionLoadingPage>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {}
