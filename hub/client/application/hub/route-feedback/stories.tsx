import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { HubWorkspace } from "@features/hub-workspace"
import { signedInWorkspace } from "@/storybook/fixtures/signed-in-workspace"

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
    description: "Prototype not found.",
  },
}

const insideWorkspace = {
  decorators: [
    (Story) => (
      <HubWorkspace data={signedInWorkspace}>
        <Story />
      </HubWorkspace>
    ),
  ],
} satisfies Pick<Story, "decorators">

export const AccessDenied: Story = {
  ...insideWorkspace,
  args: {
    status: 403,
    heading: "Access denied",
    description: "Your account no longer has Hub administrator access.",
    embedded: true,
    onRetry: fn(),
  },
}

export const UnexpectedApiResponse: Story = {
  ...insideWorkspace,
  name: "Unexpected API response",
  args: {
    heading: "Unexpected API response",
    description: "The API returned data in an unexpected shape.",
    embedded: true,
    onRetry: fn(),
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
          ...signedInWorkspace,
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
