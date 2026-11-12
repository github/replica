import type { Meta, StoryObj } from "@storybook/react-vite"

import { welcomePrototype } from "@/storybook/fixtures/prototypes"

import { PrototypeCard } from "."

const meta = {
  title: "Components/Prototype Card",
  component: PrototypeCard,
  args: {
    prototype: welcomePrototype,
    passingLabel: "passing",
    notPassingLabel: "not passing",
    noBuildLabel: "No build",
  },
} satisfies Meta<typeof PrototypeCard>

export default meta
type Story = StoryObj<typeof meta>

export const Card: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "24rem" }}>
        <Story />
      </div>
    ),
  ],
}

export const List: Story = {
  args: {
    layout: "list",
  },
  decorators: [
    (Story) => (
      <table style={{ width: "100%" }}>
        <tbody>
          <Story />
        </tbody>
      </table>
    ),
  ],
}

export const ListWithoutOwnerProfile: Story = {
  ...List,
  args: {
    layout: "list",
    prototype: {
      ...welcomePrototype,
      author: { ...welcomePrototype.author, url: null },
    },
  },
}
