import type { Meta, StoryObj } from "@storybook/react-vite"

import { ImprovementNotesPrototype } from "."

const meta = {
  title: "Components/Prototype canvas/Improvement notes prototype",
  component: ImprovementNotesPrototype,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Interactive UI-only Annotate & Fix prototype. Selection and cropped SVG captures work on the authored two-screen preview. Notes and batches are in-memory; Hub synchronization and agent outcomes are explicitly simulated. No real API requests, source edits, or publication.",
      },
    },
  },
  args: { initial: "empty" },
} satisfies Meta<typeof ImprovementNotesPrototype>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Single: Story = { args: { initial: "single" } }
export const Multiple: Story = { args: { initial: "multiple" } }
