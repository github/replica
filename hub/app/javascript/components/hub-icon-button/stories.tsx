import { HistoryIcon, TrashIcon } from "@primer/octicons-react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubIconButton } from "."

const meta = {
  title: "Components/Icon Button",
  component: HubIconButton,
  args: {
    icon: HistoryIcon,
    "aria-label": "Build history",
  },
} satisfies Meta<typeof HubIconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Action: Story = {}

export const Navigation: Story = {
  args: { as: "a", href: "#builds" },
}

export const Subtle: Story = {
  args: { variant: "invisible", size: "small" },
}

export const Destructive: Story = {
  args: {
    icon: TrashIcon,
    "aria-label": "Delete share link",
    variant: "danger",
  },
}

export const Unavailable: Story = {
  args: {
    disabled: true,
    description: "A preview is required to add comments",
  },
}
