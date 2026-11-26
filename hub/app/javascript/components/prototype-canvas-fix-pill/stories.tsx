import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { PrototypeCanvasFixPill } from "."

const meta = {
  title: "Prototype canvas/Fix pill",
  component: PrototypeCanvasFixPill,
  args: { count: 1, onFix: fn() },
} satisfies Meta<typeof PrototypeCanvasFixPill>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { count: 0 } }
export const Single: Story = {}
export const Multiple: Story = { args: { count: 12 } }
export const Fixing: Story = { args: { count: 3, busy: true } }
