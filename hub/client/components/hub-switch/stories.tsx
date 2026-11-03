import { useState } from "react"

import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubSwitch } from "."

const meta = {
  title: "Components/Switch",
  component: HubSwitch,
  args: {
    "aria-label": "Show comment pins",
    checked: true,
    onChange: () => undefined,
    size: "small",
  },
} satisfies Meta<typeof HubSwitch>

export default meta
type Story = StoryObj<typeof meta>

export const ShowPins: Story = {
  render: function ShowPinsStory(args) {
    const [checked, setChecked] = useState(args.checked)

    return <HubSwitch {...args} checked={checked} onChange={setChecked} />
  },
}

export const Unavailable: Story = {
  args: { disabled: true },
}
