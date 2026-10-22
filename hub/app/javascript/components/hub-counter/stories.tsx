import type { Meta, StoryObj } from "@storybook/react-vite"

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
