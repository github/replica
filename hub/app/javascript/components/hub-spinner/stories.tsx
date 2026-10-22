import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubSpinner } from "."

const meta = {
  title: "Components/Spinner",
  component: HubSpinner,
  args: { label: "Loading comments", size: "small" },
} satisfies Meta<typeof HubSpinner>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {}
