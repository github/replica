import type { Meta, StoryObj } from "@storybook/react-vite"

import { resolvedAnchor } from "@/storybook/fixtures/review/anchors"
import {
  defaultReviewFilters,
  repliedReviewThread,
  singleReviewThread,
} from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { mona, octocat } from "@/storybook/fixtures/users"

import { ReviewCommentsSidebar } from "."

function noop() {}

const meta = {
  title: "Hub/Features/Review/Comments Sidebar",
  component: ReviewCommentsSidebar,
  args: {
    threads: [],
    currentBuildNumber: 1,
    totalCount: 0,
    hasThreads: false,
    filters: defaultReviewFilters,
    participants: [octocat, mona],
    resolutions: new Map([[1, resolvedAnchor]]),
    selectedThreadId: null,
    selectionBlocked: false,
    closeBlocked: false,
    showPins: true,
    loading: false,
    loadFailed: false,
    copy: reviewCommentsCopy,
    onClose: noop,
    onFiltersChange: noop,
    onShowPinsChange: noop,
    onRetry: noop,
    onSelect: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ height: "44rem", position: "relative", width: "24rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewCommentsSidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const CloseBlocked: Story = {
  args: {
    closeBlocked: true,
  },
}

export const Single: Story = {
  args: {
    threads: [singleReviewThread],
    totalCount: 1,
    hasThreads: true,
  },
}

export const Multiple: Story = {
  args: {
    threads: [singleReviewThread, repliedReviewThread],
    totalCount: 2,
    hasThreads: true,
  },
}

export const Selected: Story = {
  args: {
    threads: [repliedReviewThread],
    totalCount: 1,
    hasThreads: true,
    selectedThreadId: repliedReviewThread.root.id,
  },
}

export const UnreadOnly: Story = {
  args: {
    threads: [singleReviewThread],
    totalCount: 1,
    hasThreads: true,
    filters: { ...defaultReviewFilters, showRead: false },
  },
}

export const OnlyYourThreads: Story = {
  args: {
    threads: [repliedReviewThread],
    totalCount: 1,
    hasThreads: true,
    filters: { ...defaultReviewFilters, onlyMine: true },
  },
}

export const Loading: Story = {
  args: {
    loading: true,
  },
}

export const Failure: Story = {
  args: {
    loadFailed: true,
  },
}
