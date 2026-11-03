import { useState } from "react"

import type { Meta, StoryObj } from "@storybook/react-vite"

import { PrototypeViewModeControl } from "."
import type { PrototypeViewMode } from "./types"

const meta = {
  title: "Components/Prototype View Mode Control",
  component: PrototypeViewModeControl,
  args: {
    ariaLabel: "Prototype layout",
    galleryLabel: "Gallery view",
    listLabel: "List view",
    onChange: () => undefined,
    value: "gallery",
  },
} satisfies Meta<typeof PrototypeViewModeControl>

export default meta
type Story = StoryObj<typeof meta>

export const Gallery: Story = {
  render: function PrototypeViewModeControlStory(args) {
    const [value, setValue] = useState<PrototypeViewMode>(args.value)

    return <PrototypeViewModeControl {...args} value={value} onChange={setValue} />
  },
}

export const ListSelected: Story = {
  args: { value: "list" },
  render: function ListSelectedStory(args) {
    const [value, setValue] = useState<PrototypeViewMode>(args.value)

    return <PrototypeViewModeControl {...args} value={value} onChange={setValue} />
  },
}
