import type { Meta, StoryObj } from "@storybook/react-vite"

import { WorkflowInstallation } from "."

const meta = {
  title: "Hub/Features/GitHub/Workflow Installation",
  component: WorkflowInstallation,
  args: {
    authenticityToken: "storybook-token",
    data: {
      actionLabel: "Open installation pull request",
      createPath: "/repositories/2001/workflow_installation",
      description: "Open a pull request that adds the Replica workflow for prototype branches.",
      heading: "Prototype workflow file missing",
      state: "installable",
    },
  },
} satisfies Meta<typeof WorkflowInstallation>

export default meta
type Story = StoryObj<typeof meta>

export const Installable: Story = {}

export const Updatable: Story = {
  args: {
    data: {
      actionLabel: "Open workflow update pull request",
      createPath: "/repositories/2001/workflow_installation",
      description:
        "The Replica build Action has changed. Review a pull request that replaces the installed workflow with the latest version.",
      heading: "Build Action update available",
      state: "updatable",
    },
  },
}

export const RequiresWriter: Story = {
  args: {
    data: {
      description: "A repository writer must install the Replica workflow.",
      documentationLabel: "Learn about the workflow",
      documentationUrl: "https://github.com/github/replica#prototype-build-workflow",
      heading: "Prototype workflow file missing",
      state: "requiresWriter",
    },
  },
}

export const RequiresWriterToUpdate: Story = {
  args: {
    data: {
      description: "A repository writer must review the build Action update.",
      heading: "Build Action update available",
      state: "requiresWriter",
    },
  },
}

export const Unconfigured: Story = {
  args: {
    data: {
      description:
        "The Hub operator must configure the pinned Replica build action before this workflow can be installed.",
      heading: "Prototype workflow",
      state: "unavailable",
    },
  },
}

export const CheckUnavailable: Story = {
  args: {
    data: {
      description: "Replica Hub could not check the repository workflow right now.",
      heading: "Prototype workflow",
      state: "unavailable",
    },
  },
}
