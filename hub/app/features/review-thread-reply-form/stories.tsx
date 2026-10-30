import type { Meta, StoryObj } from "@storybook/react-vite"

import { reviewCommentsCopy } from "@utils/review-comment/en"
import { mona } from "@/storybook/fixtures/users"

import { ReviewThreadReplyForm } from "."

function noop() {}

const meta = {
  title: "Hub/Features/Review/Thread Reply Form",
  component: ReviewThreadReplyForm,
  args: {
    blockedLabel: null,
    confirmingDiscard: false,
    replyDraft: "",
    replyBodyTooLong: false,
    replyFailed: false,
    replyDisabled: false,
    replying: false,
    copy: reviewCommentsCopy,
    onKeepDraft: noop,
    onDiscardDraft: noop,
    onSubmit: noop,
    onDraftChange: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "26rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewThreadReplyForm>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Draft: Story = {
  args: {
    replyDraft: "Testing.",
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: reviewCommentsCopy.replySubmitLabel }))
  },
}

export const MultilineDraft: Story = {
  args: {
    replyDraft: "I updated the spacing.\nWould you take another look?",
  },
}

export const Submitting: Story = {
  args: {
    replyDraft: "I updated the spacing.",
    replying: true,
  },
}

export const States: Story = {
  args: {
    replyDraft: "This reply could not be saved.",
    replyFailed: true,
  },
}

export const Blocked: Story = {
  args: {
    blockedLabel: reviewCommentsCopy.resolvedReplyBlockedLabel,
  },
}

export const Resolved: Story = {
  args: {
    blockedLabel: reviewCommentsCopy.resolvedByLabel.replace(
      "%{author}",
      mona.name || `@${mona.login}`,
    ),
  },
}

export const DiscardConfirmation: Story = {
  args: {
    confirmingDiscard: true,
  },
}
