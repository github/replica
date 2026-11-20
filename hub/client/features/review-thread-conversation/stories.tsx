import type { Meta, StoryObj } from "@storybook/react-vite"

import { repliedReviewThread, singleReviewThread } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { mona } from "@/storybook/fixtures/users"
import { ReviewCommentMarkers } from "@features/review-comment-markers"
import type { ReviewThread } from "@utils/review-comment/types"

import { ReviewThreadConversation } from "."

function noop() {}

function successfulAction() {
  return Promise.resolve(true)
}

const confirmedFixedThread: ReviewThread = {
  ...repliedReviewThread,
  root: {
    ...repliedReviewThread.root,
    resolvedAt: "2026-09-14T16:00:00Z",
    resolvedBy: mona,
    feedbackDigest: `sha256:${"a".repeat(64)}`,
    resolutionHistory: [
      {
        id: "c345e7bb-b7a0-4f34-8896-8bf2cc5ca269",
        sequence: 3,
        state: "resolved",
        actor: mona,
        occurredAt: "2026-09-14T16:00:00Z",
      },
    ],
    outcomeHistory: [
      {
        id: "e298ee43-09e6-40ea-9d8b-7ec321ccdc43",
        sequence: 1,
        kind: "confirmed_fixed",
        buildNumber: 2,
        verifier: mona,
        verifiedAt: "2026-09-14T17:00:00Z",
        stale: false,
        staleReason: null,
        feedbackDigest: `sha256:${"a".repeat(64)}`,
        resolutionEventId: "c345e7bb-b7a0-4f34-8896-8bf2cc5ca269",
      },
    ],
  },
}

const meta = {
  title: "Hub/Features/Review/Thread Conversation",
  component: ReviewThreadConversation,
  args: {
    thread: singleReviewThread,
    anchorPoint: { x: 480, y: 180 },
    bodyMaximumBytes: 10_000,
    mutation: null,
    copy: reviewCommentsCopy,
    onClose: noop,
    onDraftStateChange: noop,
    onReply: successfulAction,
    onEdit: successfulAction,
    onDelete: successfulAction,
    onResolve: successfulAction,
    onReopen: successfulAction,
    onRecordOutcome: successfulAction,
    onAddReaction: successfulAction,
    onRemoveReaction: successfulAction,
    onMarkRead: successfulAction,
    onMarkUnread: successfulAction,
  },
  decorators: [
    (Story, { args }) => (
      <div
        style={{
          backgroundColor: "var(--hub-canvas-muted)",
          containerType: "inline-size",
          height: "44rem",
          position: "relative",
          width: "64rem",
        }}
      >
        {args.anchorPoint ? (
          <ReviewCommentMarkers
            threads={[args.thread]}
            resolutions={
              new Map([
                [
                  args.thread.root.id,
                  {
                    commentId: args.thread.root.id,
                    status: "resolved",
                    point: args.anchorPoint,
                    rect: { x: 0, y: 0, width: 1024, height: 704 },
                  },
                ],
              ])
            }
            selectedThreadId={args.thread.root.id}
            selectionBlocked={false}
            focusSelectedMarker={false}
            copy={reviewCommentsCopy}
            onSelect={noop}
          />
        ) : null}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewThreadConversation>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {}

export const ReadOnlyConversation: Story = {
  name: "Cannot edit or delete comments",
  args: {
    thread: {
      ...singleReviewThread,
      root: {
        ...singleReviewThread.root,
        viewerCanEdit: false,
        viewerCanDelete: false,
      },
    },
  },
}

export const ReadOnlyProfile: Story = {
  args: {
    readOnly: true,
    copy: {
      ...reviewCommentsCopy,
      selectionBlockedLabel: "You can view reviews, but you do not have permission to change them.",
    },
    thread: {
      ...repliedReviewThread,
      root: { ...repliedReviewThread.root, viewerCanEdit: false, viewerCanDelete: false },
      replies: repliedReviewThread.replies.map((reply) => ({
        ...reply,
        viewerCanEdit: false,
        viewerCanDelete: false,
      })),
    },
  },
}

export const Multiple: Story = {
  args: {
    thread: repliedReviewThread,
  },
}

export const UpperRightPin: Story = {
  args: {
    thread: repliedReviewThread,
    anchorPoint: { x: 1020, y: 72 },
  },
}

export const BottomRightPin: Story = {
  args: {
    thread: repliedReviewThread,
    anchorPoint: { x: 1020, y: 650 },
  },
}

export const Resolved: Story = {
  args: {
    thread: {
      ...repliedReviewThread,
      root: {
        ...repliedReviewThread.root,
        resolvedAt: "2026-09-14T16:00:00Z",
        resolvedBy: mona,
        feedbackDigest: `sha256:${"a".repeat(64)}`,
        resolutionHistory: [
          {
            id: "c345e7bb-b7a0-4f34-8896-8bf2cc5ca269",
            sequence: 3,
            state: "resolved",
            actor: mona,
            occurredAt: "2026-09-14T16:00:00Z",
          },
        ],
      },
    },
  },
}

export const ConfirmedFixed: Story = {
  args: {
    thread: confirmedFixedThread,
  },
}

export const NeedsReverification: Story = {
  args: {
    thread: {
      ...confirmedFixedThread,
      root: {
        ...confirmedFixedThread.root,
        outcomeHistory: confirmedFixedThread.root.outcomeHistory?.map((outcome) => ({
          ...outcome,
          stale: true,
          staleReason: "thread_reopened" as const,
        })),
      },
    },
  },
}

export const ResolvedWithoutResolver: Story = {
  args: {
    thread: {
      ...repliedReviewThread,
      root: {
        ...repliedReviewThread.root,
        resolvedAt: "2026-09-14T16:00:00Z",
        resolvedBy: null,
      },
    },
  },
}
