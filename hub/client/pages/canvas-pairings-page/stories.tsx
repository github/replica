import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubWorkspace } from "@features/hub-workspace"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"
import { signedInRepository, signedInWorkspace } from "@/storybook/fixtures/signed-in-workspace"

import { CanvasPairingsPage } from "."
import type { CanvasPairingsPageData } from "./types"

const approval: Extract<CanvasPairingsPageData, { kind: "approval" }> = {
  kind: "approval",
  pageTitle: "Connect Replica canvas",
  productName: "Replica Hub",
  heading: "Connect Replica canvas",
  description: "Confirm the repository before connecting your Copilot canvas to Hub.",
  codeLabel: "Connection code",
  codeInstruction: "Only approve if this code matches the one shown in Copilot.",
  codeExpiresLabel: "This code expires at 12:10 PM.",
  code: "ABCDEF1234",
  repositoryLabel: "Repository",
  repository: githubPrototype.nameWithOwner,
  permissions:
    "This connection lets the canvas read prototype and Build status for this repository. Hub checks your current repository access.",
  expiration: "You can revoke the connection at any time from",
  connectionsLabel: "Canvas connections",
  connectionsPath: "/canvas/connections",
  approveLabel: "Approve connection",
  approvePath: "/canvas/pair/ABCDEF1234",
  cancelLabel: "Cancel",
  cancelPath: "/canvas/connections",
}

const connections: Extract<CanvasPairingsPageData, { kind: "connections" }> = {
  kind: "connections",
  pageTitle: "Canvas connections",
  productName: "Replica Hub",
  heading: "Canvas connections",
  description: "Review and revoke your Copilot canvas connections.",
  emptyLabel: "No active connections. Open the Replica canvas in Copilot to start one.",
  backLabel: "Back to repositories",
  backPath: signedInRepository.prototypesPath,
  revokeLabel: "Revoke",
  notice: null,
  grants: [
    {
      id: 1,
      repository: githubPrototype.nameWithOwner,
      expiresLabel: "Ends if unused by October 1, 2026 at 12:00 UTC",
      revokePath: "/canvas/connections/1",
    },
  ],
}

const meta = {
  title: "Hub/Pages/Canvas/Connection",
  component: CanvasPairingsPage,
  args: { data: approval },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div onSubmit={(event) => event.preventDefault()}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CanvasPairingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Approval: Story = {}

export const Connected: Story = {
  args: { data: connections, embedded: true },
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

export const Multiple: Story = {
  ...Connected,
  args: {
    ...Connected.args,
    data: {
      ...connections,
      grants: [
        ...connections.grants,
        {
          id: 2,
          repository: githubEmpty.nameWithOwner,
          expiresLabel: "Expires October 2, 2026 at 12:00 UTC",
          revokePath: "/canvas/connections/2",
        },
      ],
    },
  },
}

export const ApprovedPending: Story = {
  ...Connected,
  args: {
    ...Connected.args,
    data: {
      ...connections,
      grants: [],
      notice: "Connection approved. Return to Copilot to finish connecting.",
    },
  },
}

export const Empty: Story = {
  ...Connected,
  args: { ...Connected.args, data: { ...connections, grants: [], notice: null } },
}

export const Revoked: Story = {
  ...Empty,
  args: {
    ...Empty.args,
    data: { ...connections, grants: [], notice: "Canvas connection revoked." },
  },
}
