import type { Meta, StoryObj } from "@storybook/react-vite"

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
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ImprovementThreads>

export default meta
type Story = StoryObj<typeof meta>

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

export const NoPendingRequests: Story = {
  args: {
    open: true,
    threads: [],
  },
}
