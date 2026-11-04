import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubLoadingBar } from "."

const meta = {
  title: "Components/Loading Bar",
  component: HubLoadingBar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HubLoadingBar>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {}
