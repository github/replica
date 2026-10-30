import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { ModeNotice } from "."

const meta = {
  title: "Hub/Features/Mock Frontend Controls",
  component: ModeNotice,
  parameters: { layout: "fullscreen" },
  args: { scenario: "normal", onScenarioChange: fn(), onReset: fn() },
  render: function Render(args) {
    const [scenario, setScenario] = useState(args.scenario)
    return (
      <ModeNotice
        {...args}
        scenario={scenario}
        onScenarioChange={(value) => {
          setScenario(value)
          args.onScenarioChange(value)
        }}
      />
    )
  },
} satisfies Meta<typeof ModeNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
