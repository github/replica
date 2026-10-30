import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { ModeNotice } from "."

const meta = {
  title: "Hub/Features/Mock Frontend Controls",
  component: ModeNotice,
  parameters: { layout: "fullscreen" },
  args: {
    scenario: "normal",
    profile: "owner",
    onProfileChange: fn(),
    onScenarioChange: fn(),
    onReset: fn(),
    destinations: [
      { path: "/repositories/2001", label: "Repository" },
      { path: "/shared/demo-active", label: "Public shared preview" },
    ],
    onNavigate: fn(),
  },
  render: function Render(args) {
    const [scenario, setScenario] = useState(args.scenario)
    const [profile, setProfile] = useState(args.profile)
    return (
      <ModeNotice
        {...args}
        scenario={scenario}
        profile={profile}
        onProfileChange={(value) => {
          setProfile(value)
          args.onProfileChange?.(value)
        }}
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

export const ChangingProfile: Story = { args: { changingProfile: true } }

export const SessionUnavailable: Story = { args: { sessionUnavailable: true } }
