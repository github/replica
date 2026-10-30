import type { Meta, StoryObj } from "@storybook/react-vite"

import { PrototypeIndexHeader } from "."

const meta = {
  title: "Hub/Features/Prototype Index Header",
  component: PrototypeIndexHeader,
  args: {
    clearSearchLabel: "Clear search",
    heading: "Prototypes",
    onSearchChange: () => undefined,
    searchLabel: "Search prototypes",
    searchQuery: "",
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PrototypeIndexHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
