import { GitBranchIcon, SidebarExpandIcon } from "@primer/octicons-react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { RepositoryNavigationItem } from "."

type ItemStoryArgs = {
  href: string
  icon: typeof GitBranchIcon
  label: string
  selected: boolean
}

const meta = {
  title: "Components/Repository Navigation Item",
  component: RepositoryNavigationItem,
  render: (args: ItemStoryArgs) => <RepositoryNavigationItem {...args} />,
  args: {
    href: "#",
    icon: GitBranchIcon,
    label: "Prototypes",
    selected: false,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "12.125rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<ItemStoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Selected: Story = {
  args: { selected: true },
}

export const CollapseControl: Story = {
  render: () => (
    <RepositoryNavigationItem
      icon={SidebarExpandIcon}
      label="Collapse sidebar"
      expanded
      onClick={() => undefined}
    />
  ),
}
