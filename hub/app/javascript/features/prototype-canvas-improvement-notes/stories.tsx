import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubCounter } from "@components/hub-counter"

import "@components/prototype-canvas-toolbar/styles.css"

import { copy } from "./en"

const meta = {
  title: "Prototype canvas/Toolbar shortcuts",
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

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
