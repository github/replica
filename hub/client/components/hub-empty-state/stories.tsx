import { useState } from "react"

import { GitBranchIcon, HistoryIcon } from "@primer/octicons-react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubEmptyState } from "."

const meta = {
  title: "Components/Empty State",
  component: HubEmptyState,
  args: {
    visual: <GitBranchIcon size={48} />,
    description: "No prototype branches are available yet.",
  },
} satisfies Meta<typeof HubEmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const DescriptionOnly: Story = {}

export const WithHeading: Story = {
  args: {
    visual: <HistoryIcon size={48} />,
    heading: "No Build selected",
    description: "Select a Build to review its preview and comments.",
  },
}

export const WithAction: Story = {
  args: {
    visual: <HistoryIcon size={48} />,
    heading: "No Builds yet",
    description: "Refresh to check for a newly published Build.",
    actionLabel: "Refresh Builds",
    onAction: () => undefined,
  },
  render: function WithActionStory(args) {
    const [refreshed, setRefreshed] = useState(false)

    return (
      <HubEmptyState
        {...args}
        description={
          refreshed
            ? "No Builds are available yet."
            : "Refresh to check for a newly published Build."
        }
        actionLabel={args.actionLabel ?? "Refresh Builds"}
        actionHref={undefined}
        onAction={() => setRefreshed(true)}
      />
    )
  },
}

export const WithLink: Story = {
  args: {
    heading: "No prototypes yet",
    description: "Build your first prototype.",
    actionLabel: "Build prototype",
    actionHref: "/repositories/2001/new",
  },
}
