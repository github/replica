import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { RouteFeedback } from "."

const meta = {
  title: "Hub/Pages/Route Feedback",
  component: RouteFeedback,
  parameters: { layout: "fullscreen" },
  args: {
    kind: "error",
    heading: "Unable to load Hub",
    description: "The API could not complete the request.",
  },
} satisfies Meta<typeof RouteFeedback>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {
  args: {
    kind: "loading",
    heading: "Loading Hub",
    description: "Connecting the frontend to its API.",
  },
}

export const Failure: Story = {
  args: { status: 500, onRetry: fn() },
}

export const NotFound: Story = {
  args: {
    status: 404,
    heading: "Page or record not found",
    description: "This page is not connected in the first frontend journey.",
  },
}
