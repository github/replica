import type { Meta, StoryObj } from "@storybook/react-vite"

import { repliedReviewThread } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { CanvasReviewOverlays } from "."

function noop() {}

function unchanged() {
  return Promise.resolve(false)
}

const meta = {
  title: "Prototype canvas/Review overlays",
  component: CanvasReviewOverlays,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", position: "relative", width: "100%" }}>
        <iframe
          title="Synthetic prototype preview"
          src="/prototype-preview/index.html"
          style={{ height: "100%", width: "100%", border: 0 }}
        />
        <Story />
      </div>
    ),
  ],
  args: {
    selectionNotice: null,
    rateLimitNotice: "Too many requests. No changes were made. Wait 60 seconds, then try again.",
    composer: null,
    conversation: {
      thread: repliedReviewThread,
      anchorPoint: { x: 520, y: 220 },
      bodyMaximumBytes: 10_000,
      mutation: null,
      copy: reviewCommentsCopy,
      onClose: noop,
      onDraftStateChange: noop,
      onReply: unchanged,
      onEdit: unchanged,
      onDelete: unchanged,
      onResolve: unchanged,
      onReopen: unchanged,
      onAddReaction: unchanged,
      onRemoveReaction: unchanged,
      onMarkRead: unchanged,
      onMarkUnread: unchanged,
    },
  },
} satisfies Meta<typeof CanvasReviewOverlays>

export default meta
type Story = StoryObj<typeof meta>

export const RateLimitedWithHubClosed: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: reviewCommentsCopy.replyLabel }),
      "Please keep this unsent reply while I wait to retry.",
    )
  },
}

export const RateLimitedWithSelectionFailure: Story = {
  args: { selectionNotice: reviewCommentsCopy.areaTooSmallLabel },
  play: RateLimitedWithHubClosed.play,
}
export const SelectionFailed: Story = {
  args: {
    selectionNotice: reviewCommentsCopy.areaTooSmallLabel,
    rateLimitNotice: null,
    conversation: null,
  },
  play: undefined,
}
export const CommentComposer: Story = {
  args: {
    rateLimitNotice: null,
    conversation: null,
    composer: {
      anchorPoint: { x: 300, y: 200 },
      bodyMaximumBytes: 10_000,
      copy: reviewCommentsCopy,
      creating: false,
      onSubmit: unchanged,
      onDiscard: noop,
    },
  },
}
export const CommentSubmitting: Story = {
  ...CommentComposer,
  args: {
    ...CommentComposer.args,
    composer: { ...CommentComposer.args!.composer!, creating: true },
  },
}
export const CommentFailed: Story = {
  ...CommentComposer,
  args: {
    ...CommentComposer.args,
    composer: {
      ...CommentComposer.args!.composer!,
      submitError: "Could not save your comment. Your draft is still here.",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: reviewCommentsCopy.composerLabel }),
      "Please align this control with the content above it.",
    )
    await userEvent.click(canvas.getByRole("button", { name: reviewCommentsCopy.submitLabel }))
    await canvas.findByText("Could not save your comment. Your draft is still here.")
  },
}
