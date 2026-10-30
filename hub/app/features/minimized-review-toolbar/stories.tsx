import { Button } from "@primer/react-brand"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { welcomePrototype } from "@/storybook/fixtures/prototypes"
import { replicaBrowseData } from "@/storybook/fixtures/replica-browse"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { MinimizedReviewToolbar } from "."
import type { MinimizedReviewToolbarProps } from "./types"

function noop() {}

function InteractiveToolbar(props: MinimizedReviewToolbarProps) {
  const [selecting, setSelecting] = useState(props.reviewControls?.selecting ?? false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [selection, setSelection] = useState("")

  return (
    <div style={{ minHeight: "80vh", padding: "var(--hub-space-24)" }}>
      <h2>{props.reviewControls ? welcomePrototype.name : replicaBrowseData.prototypeName}</h2>
      {props.reviewControls ? <p>{welcomePrototype.description}</p> : null}
      <p>Drag the toolbar or focus its handle and use the arrow keys.</p>
      {selection ? <p>{selection}</p> : null}
      {sidebarOpen ? <p>{reviewCommentsCopy.heading} panel is open.</p> : null}
      {maximized ? (
        <Button size="small" onClick={() => setMaximized(false)}>
          Minimize Hub UI
        </Button>
      ) : (
        <MinimizedReviewToolbar
          {...props}
          onMaximize={() => setMaximized(true)}
          reviewControls={
            props.reviewControls
              ? {
                  ...props.reviewControls,
                  selecting,
                  sidebarOpen,
                  onCancelSelection: () => {
                    setSelecting(false)
                    setSelection("")
                  },
                  onStartElementSelection: () => {
                    setSelecting(true)
                    setSelection(reviewCommentsCopy.commentOnElementLabel)
                  },
                  onStartAreaSelection: () => {
                    setSelecting(true)
                    setSelection(reviewCommentsCopy.highlightRegionLabel)
                  },
                  onToggleSidebar: () => setSidebarOpen(!sidebarOpen),
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

const meta = {
  title: "Hub/Features/Review/Minimized Toolbar",
  component: MinimizedReviewToolbar,
  parameters: { layout: "fullscreen" },
  args: {
    maximizeLabel: "Maximize Hub UI",
    dragLabel: "Move review toolbar",
    onMaximize: noop,
    reviewControls: {
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
  },
  render: (args) => <InteractiveToolbar {...args} />,
} satisfies Meta<typeof MinimizedReviewToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Browse: Story = {
  args: {
    reviewControls: undefined,
    maximizeLabel: replicaBrowseData.maximizeHubLabel,
    dragLabel: replicaBrowseData.dragControlsLabel,
  },
}

export const Single: Story = {
  args: {
    reviewControls: { ...meta.args.reviewControls, commentCount: 1, hasUnreadComments: true },
  },
}

export const Multiple: Story = {
  args: {
    reviewControls: { ...meta.args.reviewControls, commentCount: 3, hasUnreadComments: true },
  },
}

export const Selecting: Story = {
  args: { reviewControls: { ...meta.args.reviewControls, selecting: true } },
}

export const Unavailable: Story = {
  args: { reviewControls: { ...meta.args.reviewControls, bridgeReady: false } },
}

export const ProtectedDraft: Story = {
  args: {
    reviewControls: {
      ...meta.args.reviewControls,
      selectionBlocked: true,
      sidebarToggleBlocked: true,
    },
  },
}
