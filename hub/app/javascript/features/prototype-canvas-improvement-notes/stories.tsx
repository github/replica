import { ChatIcon, CrosshairsIcon } from "@primer/octicons-react"
import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { ShortcutTooltip } from "@components/shortcut-tooltip"
import { reviewCommentsCopy } from "@utils/review-comment/en"

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
