import type { Meta, StoryObj } from "@storybook/react-vite"

import { movedAnchor, resolvedAnchor } from "@/storybook/fixtures/review/anchors"
import {
  repliedReviewThread,
  overflowReviewParticipants,
  singleReviewThread,
} from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { mona } from "@/storybook/fixtures/users"
import type { ReviewThread } from "@utils/review-comment/types"

import { ReviewCommentMarkers } from "."

function selectThread() {}

const secondThread: ReviewThread = {
  ...repliedReviewThread,
  root: {
    ...repliedReviewThread.root,
    id: 3,
    author: mona,
    body: "The card needs a clearer selected state.",
  },
}

const secondResolution = {
  ...movedAnchor,
  commentId: 3,
  rect: { x: 340, y: 230, width: 180, height: 80 },
  point: { x: 430, y: 270 },
} as const

const meta = {
  title: "Hub/Features/Review/Comment Markers",
  component: ReviewCommentMarkers,
  args: {
    threads: [],
    resolutions: new Map(),
    selectedThreadId: null,
    selectionBlocked: false,
    copy: reviewCommentsCopy,
    onSelect: selectThread,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          background: "linear-gradient(135deg, var(--hub-canvas-default), var(--hub-canvas-muted))",
          border: "1px solid var(--hub-border-default)",
          height: "30rem",
          overflow: "hidden",
          position: "relative",
          width: "48rem",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewCommentMarkers>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Single: Story = {
  args: {
    threads: [singleReviewThread],
    resolutions: new Map([[1, resolvedAnchor]]),
  },
}

export const UpperRightPin: Story = {
  args: {
    threads: [singleReviewThread],
    resolutions: new Map([
      [
        1,
        {
          ...resolvedAnchor,
          point: { x: 744, y: 72 },
          rect: { x: 0, y: 0, width: 768, height: 480 },
        },
      ],
    ]),
    selectedThreadId: 1,
  },
}

export const Multiple: Story = {
  args: {
    threads: [singleReviewThread, secondThread],
    resolutions: new Map([
      [1, resolvedAnchor],
      [3, secondResolution],
    ]),
    selectedThreadId: 3,
  },
}

export const Overflow: Story = {
  args: {
    threads: [
      {
        ...repliedReviewThread,
        participants: overflowReviewParticipants,
      },
    ],
    resolutions: new Map([[1, resolvedAnchor]]),
  },
}

export const FocusedStack: Story = {
  ...Overflow,
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab()
    canvas.getByRole("button", { name: /thread started by/i }).focus({ preventScroll: true })
  },
}
