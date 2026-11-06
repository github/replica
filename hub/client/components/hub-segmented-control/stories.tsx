import { useState } from "react"

import { AppsIcon, ListUnorderedIcon } from "@primer/octicons-react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubSegmentedControl } from "."

const meta = {
  title: "Components/Segmented Control",
  component: HubSegmentedControl,
  args: {
    "aria-label": "Density",
    options: [
      { label: "Comfortable", value: "comfortable" },
      { label: "Compact", value: "compact" },
    ],
    onChange: () => undefined,
    value: "comfortable",
  },
} satisfies Meta<typeof HubSegmentedControl>

export default meta
type Story = StoryObj<typeof meta>

export const Text: Story = {
  render: function TextStory(args) {
    const [value, setValue] = useState(args.value)

    return <HubSegmentedControl {...args} value={value} onChange={setValue} />
  },
}

export const IconOnly: Story = {
  args: {
    "aria-label": "Prototype layout",
    options: [
      { icon: AppsIcon, label: "Gallery view", value: "gallery" },
      { icon: ListUnorderedIcon, label: "List view", value: "list" },
    ],
    value: "gallery",
    variant: "icon",
  },
  render: function IconOnlyStory(args) {
    const [value, setValue] = useState(args.value)

    return <HubSegmentedControl {...args} value={value} onChange={setValue} />
  },
}

export const FullWidth: Story = {
  args: { fullWidth: true },
  decorators: [
    (Story) => (
      <div style={{ width: "20rem" }}>
        <Story />
      </div>
    ),
  ],
}

export const Unavailable: Story = {
  args: { disabled: true },
}
