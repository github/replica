import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { HubWorkspace } from "@features/hub-workspace"
import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"

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

export const CanvasAccountMismatch: Story = {
  args: {
    heading: "Canvas connections unavailable",
    description:
      "Your Hub account changed while loading connections. Try again to see your connections.",
    embedded: true,
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <HubWorkspace
        data={{
          ...authenticatedHubWorkspaceData,
          canvasConnectionsPath: "/canvas/connections",
          selectedSection: "canvas",
        }}
      >
        <Story />
      </HubWorkspace>
    ),
  ],
}

export const CanvasAccountRetrying: Story = {
  ...CanvasAccountMismatch,
  args: { ...CanvasAccountMismatch.args, retrying: true },
}
