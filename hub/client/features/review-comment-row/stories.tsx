import type { Meta, StoryObj } from "@storybook/react-vite"

import { movedAnchor } from "@/storybook/fixtures/review/anchors"
import { repliedReviewThread, singleReviewThread } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentRow } from "."

function selectThread() {}

const meta = {
  title: "Hub/Features/Review/Comment Row",
  component: ReviewCommentRow,
  args: {
    thread: singleReviewThread,
    currentBuildNumber: 1,
    resolution: undefined,
    selected: false,
    selectionBlocked: false,
    copy: reviewCommentsCopy,
    onSelect: selectThread,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "22rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewCommentRow>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {}

export const Read: Story = {
  args: { thread: { ...singleReviewThread, unread: false } },
}

export const MultipleMessages: Story = {
  args: {
    thread: repliedReviewThread,
    currentBuildNumber: 2,
    buildHref: `https://hub.example.com${repliedReviewThread.root.buildPath}`,
  },
}

export const LongAuthor: Story = {
  args: {
    thread: {
      ...repliedReviewThread,
      root: {
        ...repliedReviewThread.root,
        author: { ...repliedReviewThread.root.author, name: "The Octocat with a long name" },
      },
    },
    currentBuildNumber: 2,
  },
}

export const Moved: Story = {
  args: {
    thread: repliedReviewThread,
    resolution: movedAnchor,
  },
}

export const Selected: Story = {
  args: {
    thread: repliedReviewThread,
    selected: true,
  },
}

export const SelectionBlocked: Story = {
  args: {
    thread: repliedReviewThread,
    selectionBlocked: true,
  },
}
