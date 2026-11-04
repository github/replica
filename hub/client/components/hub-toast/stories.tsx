import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubAlert } from "../hub-alert"
import { HubToast } from "."

const meta = {
  title: "Components/Toast",
  component: HubToast,
  args: { title: "Changes saved" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HubToast>

export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = {}

export const Information: Story = {
  args: { title: "Webhook rotation is idle.", variant: "info" },
}

export const Stacked: Story = {
  render: () => (
    <>
      <HubToast title="Changes saved" />
      <HubToast title="Webhook rotation is idle." variant="info" />
    </>
  ),
}

export const WithInlineError: Story = {
  render: () => (
    <>
      <HubAlert title="Choose a destination region before saving." variant="critical" />
      <HubToast title="Other changes saved" />
    </>
  ),
}
