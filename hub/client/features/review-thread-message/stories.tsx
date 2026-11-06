import type { Meta, StoryObj } from "@storybook/react-vite"

import { octocatRootComment, repliedReviewThread } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewThreadMessage } from "."

function noop() {}

function updateReaction() {
  return Promise.resolve(true)
}

const meta = {
  title: "Hub/Features/Review/Thread Message",
  component: ReviewThreadMessage,
  parameters: {
    docs: {
      description: {
        component:
          "The comment actions use Primer Brand ActionMenu at small size. Open the ellipsis for Edit and Delete.",
      },
    },
  },
  args: {
    comment: octocatRootComment,
    mutation: null,
    copy: reviewCommentsCopy,
    editing: false,
    editDraft: "",
    editBodyTooLong: false,
    editFailed: false,
    confirmingEditDiscard: false,
    saving: false,
    confirmingDelete: false,
    deleting: false,
    deleteFailed: false,
    actionsDisabled: false,
    onStartEdit: noop,
    onEditDraftChange: noop,
    onSaveEdit: noop,
    onCancelEdit: noop,
    onKeepEdit: noop,
    onDiscardEdit: noop,
    onRequestDelete: noop,
    onCancelDelete: noop,
    onDelete: noop,
    onAddReaction: updateReaction,
    onRemoveReaction: updateReaction,
    onBurstReaction: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "28rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewThreadMessage>

export default meta
type Story = StoryObj<typeof meta>

export const Root: Story = {}

export const ActionsDisabled: Story = {
  args: {
    actionsDisabled: true,
  },
}

export const Reply: Story = {
  args: {
    comment: repliedReviewThread.replies[0],
  },
}

export const Edited: Story = {
  args: {
    comment: { ...octocatRootComment, editedAt: "2026-09-14T14:00:00Z" },
  },
}

export const Editing: Story = {
  args: {
    editing: true,
    editDraft: octocatRootComment.body ?? "",
  },
}

export const EditConfirmation: Story = {
  args: {
    editing: true,
    editDraft: "An unsaved update to this comment.",
    confirmingEditDiscard: true,
  },
}

export const DeleteConfirmation: Story = {
  args: {
    confirmingDelete: true,
  },
}
