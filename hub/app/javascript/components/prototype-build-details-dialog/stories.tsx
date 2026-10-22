import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { BuildDetailsDialog } from "."
import { copy } from "@utils/prototype-canvas/en"

const meta = {
  title: "Components/Prototype canvas/Build details dialog",
  component: BuildDetailsDialog,
  args: {
    state: {
      name: "Example",
      sessionId: "11111111-2222-4333-8444-555555555555",
      stats: {
        branch: "prototype/welcome",
        comparison: { branch: "main", source: "local", behind: 0, error: null },
      },
    },
    titleButtonRef: createRef<HTMLButtonElement>(),
    onClose: () => undefined,
  },
} satisfies Meta<typeof BuildDetailsDialog>

export default meta
type Story = StoryObj<typeof meta>

export const LocalMain: Story = {}

export const BehindUpstream: Story = {
  args: {
    state: {
      ...meta.args.state,
      stats: {
        ...meta.args.state.stats,
        comparison: { branch: "origin/main", source: "upstream", behind: 2, error: null },
      },
    },
  },
}

export const Unavailable: Story = {
  args: { state: { name: "Welcome", stats: {} } },
}

export const BranchCheckFailed: Story = {
  args: {
    state: {
      ...meta.args.state,
      stats: { ...meta.args.state.stats, branchError: "Could not read the current branch." },
    },
  },
}

export const ComparisonFailed: Story = {
  args: {
    state: {
      ...meta.args.state,
      stats: {
        ...meta.args.state.stats,
        comparison: {
          branch: "origin/main",
          source: "upstream",
          behind: null,
          error: "Could not compare this checkout with origin/main.",
        },
      },
    },
  },
}

export const BranchCopied: Story = {
  beforeEach: () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    })
    return () => {
      if (previous) Object.defineProperty(navigator, "clipboard", previous)
      else Reflect.deleteProperty(navigator, "clipboard")
    }
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: copy.copyBranch }))
  },
}

export const SessionCopied: Story = {
  beforeEach: BranchCopied.beforeEach,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy session ID" }))
  },
}

export const CopyFailed: Story = {
  beforeEach: () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard access was denied.")) },
    })
    return () => {
      if (previous) Object.defineProperty(navigator, "clipboard", previous)
      else Reflect.deleteProperty(navigator, "clipboard")
    }
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: copy.copyBranch }))
    await canvas.findByRole("alert")
  },
}
