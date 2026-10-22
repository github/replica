import type { Meta, StoryObj } from "@storybook/react-vite"

import { BuildStateLabel } from "."
import type { BuildState } from "./types"

const meta = {
  title: "Components/Build State Label",
  component: BuildStateLabel,
  args: {
    label: "Successful",
    state: "successful",
  },
} satisfies Meta<typeof BuildStateLabel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

const states: Array<{ label: string; state: BuildState }> = [
  { label: "Queued", state: "queued" },
  { label: "Running", state: "running" },
  { label: "Successful", state: "successful" },
  { label: "Failed", state: "failed" },
  { label: "Superseded", state: "superseded" },
]

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      {states.map((state) => (
        <BuildStateLabel key={state.state} {...state} />
      ))}
    </div>
  ),
}
