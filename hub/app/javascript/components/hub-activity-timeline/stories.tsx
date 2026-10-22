import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubActivityTimeline } from "."

const meta = {
  title: "Components/Activity Timeline",
  component: HubActivityTimeline,
  args: {
    "aria-label": "Build activity",
    items: [
      {
        id: "created",
        dateTime: "2026-09-22T10:00:00Z",
        label: "Queued at 10:00",
      },
      {
        id: "started",
        dateTime: "2026-09-22T10:01:00Z",
        label: "Workflow started at 10:01",
      },
      {
        id: "completed",
        dateTime: "2026-09-22T10:03:00Z",
        label: "Build published at 10:03",
      },
    ],
  },
} satisfies Meta<typeof HubActivityTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const Published: Story = {}

export const Queued: Story = {
  args: { items: meta.args.items.slice(0, 1) },
}
