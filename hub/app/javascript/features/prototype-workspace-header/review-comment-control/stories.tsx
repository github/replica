import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { reviewCommentsCopy } from "@utils/review-comment/en"
import { copy as canvasCopy } from "@utils/prototype-canvas/en"

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
    onStartSelection: noop,
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

export const CanvasVisibilityMenu: Story = {
  render: (args) => {
    function CanvasControl() {
      const [visible, setVisible] = useState(true)
      return (
        <ReviewCommentControl
          {...args}
          visibilityAction={{
            label: visible ? canvasCopy.hideComments : canvasCopy.showComments,
            onToggle: () => setVisible((previous) => !previous),
          }}
        />
      )
    }
    return <CanvasControl />
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    await canvas.findByRole("menuitem", { name: canvasCopy.hideComments })
  },
}

export const CanvasCommentsHidden: Story = {
  ...CanvasVisibilityMenu,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel })
    await userEvent.click(trigger)
    await userEvent.click(await canvas.findByRole("menuitem", { name: canvasCopy.hideComments }))
    await userEvent.click(trigger)
    await canvas.findByRole("menuitem", { name: canvasCopy.showComments })
  },
}

export const CanvasSelecting: Story = {
  args: {
    selecting: true,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(
      canvas.getByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
    )
  },
}
