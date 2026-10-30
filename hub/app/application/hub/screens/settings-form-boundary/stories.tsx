import type { Meta, StoryObj } from "@storybook/react-vite"

import { LearningsPage } from "@pages/learnings-page"
import learningsStory from "@pages/learnings-page/stories"

import { SettingsFormBoundary } from "."

const meta = {
  title: "Hub/Features/Settings form boundary",
  component: SettingsFormBoundary,
  parameters: { layout: "fullscreen" },
  args: {
    busy: false,
    mock: true,
    onSubmit: () => {},
    children: <LearningsPage data={learningsStory.args.data} />,
  },
} satisfies Meta<typeof SettingsFormBoundary>

export default meta
type Story = StoryObj<typeof meta>

export const Error: Story = {
  args: { error: "The mock settings could not be saved. Retry with the controls below." },
}

export const Success: Story = {
  args: { notice: "Mock settings saved. No external service was contacted." },
}
