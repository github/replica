import { useState } from "react"

import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubAlert } from "."

const meta = {
  title: "Components/Alert",
  component: HubAlert,
  args: { title: "The Build could not be published", variant: "critical" },
} satisfies Meta<typeof HubAlert>

export default meta
type Story = StoryObj<typeof meta>

export const Warning: Story = {
  args: { title: "Repository access changed", variant: "warning" },
}

export const WithAction: Story = {
  args: {
    title: "Repository access changed",
    variant: "warning",
    action: <Button size="small">Review access</Button>,
  },
}

export const Failure: Story = {
  args: { description: "Check the workflow log and try again.", layout: "compact" },
  play: ({ canvasElement }) => {
    const title = canvasElement.querySelector(".hub-alert__title")
    const description = canvasElement.querySelector(".hub-alert__description")
    if (!title || !description) throw new Error("Alert must show its title and description.")

    const titleWeight = Number(getComputedStyle(title).fontWeight)
    const descriptionWeight = Number(getComputedStyle(description).fontWeight)
    const boldWeight = Number(
      getComputedStyle(title).getPropertyValue("--brand-text-weight-bold").trim(),
    )
    if (titleWeight !== boldWeight || titleWeight <= descriptionWeight)
      throw new Error("Alert title must use Brand bold weight; description must remain regular.")
  },
}

export const Information: Story = {
  args: { title: "Comments are ready", variant: "info" },
}

export const Success: Story = {
  args: { title: "Changes saved", variant: "success" },
}

export const Dismissible: Story = {
  args: { title: "Repository access changed", variant: "warning" },
  render: function DismissibleAlertStory(args) {
    const [visible, setVisible] = useState(true)

    return (
      <div>
        {visible ? (
          <HubAlert {...args} dismissLabel="Dismiss warning" onDismiss={() => setVisible(false)} />
        ) : null}
      </div>
    )
  },
}
