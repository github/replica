import type { Meta, StoryObj } from "@storybook/react-vite"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentControl } from "."

function noop() {}

const meta = {
  title: "Hub/Features/Review/Comment Control",
  component: ReviewCommentControl,
  parameters: {
    docs: {
      description: {
        component:
          "The icon trigger and small menu use Primer Brand ActionMenu; unavailable and blocked states retain their disabled labels.",
      },
    },
  },
  args: {
    bridgeReady: true,
    copy: reviewCommentsCopy,
    selectionBlocked: false,
    selecting: false,
    onCancelSelection: noop,
    onStartAreaSelection: noop,
    onStartElementSelection: noop,
  },
} satisfies Meta<typeof ReviewCommentControl>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const Unavailable: Story = {
  args: {
    bridgeReady: false,
  },
}

export const Blocked: Story = {
  args: {
    selectionBlocked: true,
  },
}

export const Selecting: Story = {
  args: {
    selecting: true,
  },
}
