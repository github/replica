import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@primer/react-brand"
import type { CSSProperties } from "react"

import { HubCounter } from "."

const meta = {
  title: "Components/Counter",
  component: HubCounter,
  args: { children: 12 },
} satisfies Meta<typeof HubCounter>

export default meta
type Story = StoryObj<typeof meta>

export const Comments: Story = {
  decorators: [
    (Story) => (
      <h2 style={{ fontSize: "1rem" }}>
        Comments <Story />
      </h2>
    ),
  ],
}

export const CanvasCounters: Story = {
  render: () => {
    const style: CSSProperties & { "--hub-counter-background": string } = {
      "--hub-counter-background": "color-mix(in srgb, var(--hub-fg-default) 10%, transparent)",
      display: "flex",
      gap: "1rem",
      alignItems: "center",
    }
    return (
      <div style={style}>
        <HubCounter>0</HubCounter>
        <Button variant="secondary" trailingVisual={<HubCounter>12</HubCounter>}>
          Comments
        </Button>
        <Button variant="primary" trailingVisual={<HubCounter>3</HubCounter>}>
          Fix all
        </Button>
        <Button variant="primary" disabled trailingVisual={<HubCounter>0</HubCounter>}>
          Fix all
        </Button>
      </div>
    )
  },
}
