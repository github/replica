import type { Meta, StoryObj } from "@storybook/react-vite"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentComposer } from "."

function submitComment() {
  return Promise.resolve(true)
}

function discardComment() {}

const meta = {
  title: "Features/Review/Comment Composer",
  component: ReviewCommentComposer,
  args: {
    anchorPoint: { x: 360, y: 180 },
    bodyMaximumBytes: 10_000,
    copy: reviewCommentsCopy,
    creating: false,
    onSubmit: submitComment,
    onDiscard: discardComment,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          backgroundColor: "var(--hub-canvas-muted)",
          height: "32rem",
          position: "relative",
          width: "52rem",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewCommentComposer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Dark: Story = { globals: { colorMode: "night" } }

export const SubmitShortcut: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: reviewCommentsCopy.composerLabel }),
      "Please align this control with the content above it.",
    )
    await userEvent.hover(canvas.getByRole("button", { name: reviewCommentsCopy.submitLabel }))
  },
}

export const Creating: Story = {
  args: {
    creating: true,
  },
}

export const SubmissionFailed: Story = {
  args: {
    submitError: "Hub is temporarily unavailable. Your comment is still here. Try saving again.",
    onSubmit: () => Promise.resolve(false),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: reviewCommentsCopy.composerLabel }),
      "Please align this control with the content above it.",
    )
    await userEvent.click(canvas.getByRole("button", { name: reviewCommentsCopy.submitLabel }))
  },
}
