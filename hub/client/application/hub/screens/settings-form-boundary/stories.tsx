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
    onSubmit: () => {},
    children: <LearningsPage data={learningsStory.args.data} />,
  },
} satisfies Meta<typeof SettingsFormBoundary>

export default meta
type Story = StoryObj<typeof meta>

export const Error: Story = {
  args: { error: "The settings could not be saved. Try again." },
}

export const Success: Story = {
  args: { notice: "Settings saved." },
}
