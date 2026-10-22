import type { Meta, StoryObj } from "@storybook/react-vite"

import { ReplicaLogo } from "."

const meta = {
  title: "Components/Replica Logo",
  component: ReplicaLogo,
  args: { size: "medium" },
  argTypes: {
    size: { control: "select", options: ["small", "medium", "large"] },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof ReplicaLogo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
