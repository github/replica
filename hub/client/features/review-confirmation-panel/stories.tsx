import type { Meta, StoryObj } from "@storybook/react-vite"

import { ReviewConfirmationPanel } from "."

function noop() {}

const meta = {
  title: "Hub/Features/Review/Confirmation Panel",
  component: ReviewConfirmationPanel,
  args: {
    cancelLabel: "Keep",
    confirmLabel: "Discard",
    description: "This comment has not been submitted.",
    heading: "Keep this draft?",
    onCancel: noop,
    onConfirm: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "24rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewConfirmationPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Compact: Story = {
  args: {
    compact: true,
  },
}

export const Condensed: Story = {
  args: {
    condensed: true,
  },
}

export const FailedDeletion: Story = {
  args: {
    cancelLabel: "Cancel",
    confirmLabel: "Delete",
    description: "Deleted comment text cannot be recovered.",
    errorLabel: "The comment could not be deleted.",
    heading: "Delete this comment?",
    compact: true,
  },
}
