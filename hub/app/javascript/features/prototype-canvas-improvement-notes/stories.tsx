import { ChatIcon, CrosshairsIcon } from "@primer/octicons-react"
import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { ShortcutTooltip } from "@components/shortcut-tooltip"
import { HubCounter } from "@components/hub-counter"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import "@components/prototype-canvas-toolbar/styles.css"

import { copy } from "./en"

const meta = {
  title: "Prototype canvas/Toolbar shortcuts",
  component: ShortcutTooltip,
  args: { text: copy.annotateShortcut, shortcut: "S" },
  render: (args) => (
    <div style={{ display: "flex", gap: "1rem", padding: "3rem" }}>
      <ShortcutTooltip text={reviewCommentsCopy.commentMenuLabel} shortcut="C">
        <Button variant="secondary" size="small" leadingVisual={<ChatIcon />} aria-keyshortcuts="C">
          {reviewCommentsCopy.commentMenuLabel}
        </Button>
      </ShortcutTooltip>
      <ShortcutTooltip {...args}>
        <Button
          variant="secondary"
          size="small"
          leadingVisual={<CrosshairsIcon />}
          aria-keyshortcuts="S"
        >
          {copy.annotate}
        </Button>
      </ShortcutTooltip>
    </div>
  ),
} satisfies Meta<typeof ShortcutTooltip>

export default meta
type Story = StoryObj<typeof meta>

export const CanvasShortcuts: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: copy.annotate }))
    await canvas.findByRole("tooltip")
  },
}

export const SelectionCounters: Story = {
  render: () => (
    <div className="canvas-toolbar">
      <Button variant="secondary" size="small" aria-label="Comments, 7">
        <HubCounter>7</HubCounter>
      </Button>
      <Button variant="secondary" size="small" aria-label="Comments, 7" disabled>
        <HubCounter>7</HubCounter>
      </Button>
      <Button variant="secondary" size="small" aria-label={copy.openNotes(2)}>
        <HubCounter>2</HubCounter>
      </Button>
      <Button variant="secondary" size="small" aria-label={copy.openNotes(2)} disabled>
        <HubCounter>2</HubCounter>
      </Button>
    </div>
  ),
}
