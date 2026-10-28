import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState, type ComponentProps } from "react"

import { CanvasReviewFeedback } from "@components/canvas-review-feedback"

import { ImprovementThreads } from "."

const meta = {
  title: "Components/Prototype canvas/Improvement threads",
  component: ImprovementThreads,
  parameters: { layout: "fullscreen" },
  args: {
    identity: "story",
    active: true,
    open: false,
    threads: [
      {
        id: 1,
        revision: 1,
        author: "Alex Morgan",
        body: "Keep the save action visible while editing project details.",
        target: "Save project",
        path: "/projects",
        status: "open",
        originalPending: true,
        messages: [],
        point: { x: 240, y: 160 },
      },
    ],
    onOpen: () => {},
    onClose: () => {},
    onFollowUp: () => Promise.resolve(false),
    onResolve: () => Promise.resolve(false),
    onDelete: () => Promise.resolve(false),
    onFix: () => Promise.resolve(false),
  },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: "100vh" }}>
        <CanvasReviewFeedback>
          <Story />
        </CanvasReviewFeedback>
      </div>
    ),
  ],
} satisfies Meta<typeof ImprovementThreads>

export default meta
type Story = StoryObj<typeof meta>

function FailedActions(props: ComponentProps<typeof ImprovementThreads>) {
  const [error, setError] = useState("")
  return (
    <ImprovementThreads
      {...props}
      error={error}
      onFollowUp={() => {
        setError("The follow-up could not be saved. Try again.")
        return Promise.resolve(false)
      }}
      onDelete={() => {
        setError("The improvement could not be deleted. Try again.")
        return Promise.resolve(false)
      }}
    />
  )
}

export const PinsWithoutSidebar: Story = {}

export const ActiveNotes: Story = {
  args: { open: true },
}

export const BlockedNotes: Story = {
  args: {
    open: true,
    onRetry: () => Promise.resolve(false),
    threads: [
      {
        ...meta.args.threads[0]!,
        status: "blocked",
        retryStatus: "blocked",
      },
      {
        ...meta.args.threads[0]!,
        id: 2,
        author: "Jordan Lee",
        body: "Keep the project description visible beside the save action while editing longer project details.",
        status: "blocked",
        retryStatus: "blocked",
      },
    ],
  },
}

export const CopilotAnswer: Story = {
  args: {
    open: true,
    threads: [
      {
        ...meta.args.threads[0]!,
        status: "ready",
        originalPending: false,
        messages: [
          {
            id: "answer",
            role: "copilot",
            body: "The save action now remains visible while editing project details.",
          },
        ],
      },
    ],
  },
}

export const AuthorIdentityUnavailable: Story = {
  args: {
    open: true,
    error:
      "Upgrade Hub to confirm the connected author's account ID. Author attribution is unavailable.",
  },
}

export const FollowUpFailure: Story = {
  args: { open: true },
  render: (args) => <FailedActions {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open improvement: Keep the save action visible while editing project details.",
      }),
    )
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Follow-up" }),
      "Keep the action visible on narrow screens too.",
    )
    await userEvent.click(canvas.getByRole("button", { name: "Add follow-up" }))
    await canvas.findByRole("region", { name: "Comment notifications" })
  },
}

export const DeleteFailure: Story = {
  args: { open: true },
  render: (args) => <FailedActions {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Improvement actions: 1" }))
    await userEvent.click(canvas.getByRole("menuitem", { name: "Delete improvement" }))
    await userEvent.click(canvas.getByRole("button", { name: "Delete improvement" }))
    await canvas.findByRole("region", { name: "Comment notifications" })
  },
}

export const NoPendingRequests: Story = {
  args: {
    open: true,
    threads: [],
  },
}
