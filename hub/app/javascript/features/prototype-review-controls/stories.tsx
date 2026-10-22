import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { PrototypeReviewControls } from "."
import type { PrototypeReviewControlsProps } from "./types"

function noop() {}

function InteractiveControls(props: PrototypeReviewControlsProps) {
  const [selecting, setSelecting] = useState(props.selecting)
  const [sidebarOpen, setSidebarOpen] = useState(props.sidebarOpen)

  return (
    <PrototypeReviewControls
      {...props}
      selecting={selecting}
      sidebarOpen={sidebarOpen}
      onCancelSelection={() => setSelecting(false)}
      onStartElementSelection={() => setSelecting(true)}
      onStartAreaSelection={() => setSelecting(true)}
      onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
    />
  )
}

const meta = {
  title: "Hub/Features/Review/Prototype Review Controls",
  component: PrototypeReviewControls,
  args: {
    bridgeReady: true,
    commentCount: 0,
    copy: reviewCommentsCopy,
    hasUnreadComments: false,
    selectionBlocked: false,
    selecting: false,
    sidebarToggleBlocked: false,
    sidebarOpen: false,
    onCancelSelection: noop,
    onStartAreaSelection: noop,
    onStartElementSelection: noop,
    onToggleSidebar: noop,
  },
  render: (args) => <InteractiveControls {...args} />,
} satisfies Meta<typeof PrototypeReviewControls>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Single: Story = { args: { commentCount: 1 } }
export const Multiple: Story = { args: { commentCount: 3, hasUnreadComments: true } }
