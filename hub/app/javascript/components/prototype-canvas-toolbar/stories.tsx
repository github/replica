import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { Toolbar } from "."

const config = {
  name: "Prototype",
  prototypeUrl: "http://localhost:3000",
  token: "local-token",
}

const meta = {
  title: "Prototype canvas/Toolbar",
  component: Toolbar,
  parameters: {
    docs: {
      description: {
        component:
          "Neutral toolbar toggles use the standard Brand hover fill when selected, and the darker pressed fill when a selected button is hovered or pressed. Unselected and disabled styling stays with the original components. Edit details includes a pencil icon. Below 1024px, Edit details and the live canvas Pick & polish control retain their icons, accessible names, and tooltips while hiding their labels.",
      },
    },
  },
  args: {
    config,
    prototypeName: "Prototype",
    onPublish: () => undefined,
    onShare: () => undefined,
    shareButtonRef: createRef<HTMLButtonElement>(),
    onBuildDetails: () => undefined,
    onHub: () => undefined,
    onControls: () => undefined,
    controlsOpen: false,
    hubOpen: false,
    publishButtonRef: createRef<HTMLButtonElement>(),
    titleButtonRef: createRef<HTMLButtonElement>(),
    publishing: false,
    state: {
      name: "Prototype",
      stats: {
        branch: "prototype/welcome",
        repository: "github/prototype",
        commitSha: "a".repeat(40),
        workingTree: "clean",
        urlHost: "localhost:3000",
      },
      publishStatus: { state: "not_published", detail: "No Replica workflow run was found." },
    },
  },
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

export const NotPublished: Story = {}

export const ControlsClosed: Story = {
  args: { onControls: () => undefined, controlsOpen: false },
}

export const ControlsOpen: Story = {
  args: { onControls: () => undefined, controlsOpen: true },
}

export const Untitled: Story = {
  args: { prototypeName: undefined },
}

export const Requested: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: {
        state: "requested",
        detail: "Copilot has the request and will continue in chat.",
      },
    },
  },
}

export const InProgress: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: { state: "in_progress", detail: "Replica workflow is in progress." },
    },
  },
}

export const Published: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: {
        state: "published",
        detail: "The latest Replica workflow completed successfully.",
      },
    },
  },
}

export const Failed: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: {
        state: "failed",
        detail: "The latest Replica workflow finished with failure.",
      },
    },
  },
}

export const Unavailable: Story = {
  args: { state: null },
}
export const Publishing: Story = { args: { publishing: true } }
export const HubOpen: Story = { args: { hubOpen: true } }
