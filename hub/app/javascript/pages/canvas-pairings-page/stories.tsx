import type { Meta, StoryObj } from "@storybook/react-vite"

import { CanvasPairingsPage } from "."
import type { CanvasPairingsPageData } from "./types"

const approval: CanvasPairingsPageData = {
  kind: "approval",
  pageTitle: "Connect Replica canvas",
  productName: "Replica Hub",
  heading: "Connect Replica canvas",
  description: "Confirm this connection before letting Copilot access your Hub reviews.",
  codeLabel: "Connection code",
  codeInstruction: "Only approve if this code matches the one shown in your Copilot canvas.",
  code: "ABCDEF1234",
  repositoryLabel: "Repository",
  repository: "local/example",
  permissions:
    "The canvas can read Build details and review conversations, edit prototype details, and participate in conversations with your Hub account. It can create review threads when the local checkout matches an imported Build. The connection also lets Copilot add the learnings this repository's administrators accepted to your prompts.",
  learningsConsentVersion: "1",
  expiration:
    "Connections expire after seven days. Hub checks your current repository access on every request. You can revoke access from",
  connectionsLabel: "Canvas connections",
  connectionsPath: "/canvas/connections",
  approveLabel: "Approve connection",
  approvePath: "/canvas/pair/ABCDEF1234",
  cancelLabel: "Cancel",
  cancelPath: "/repositories",
  authenticityToken: "storybook-token",
}

const connections: CanvasPairingsPageData = {
  kind: "connections",
  pageTitle: "Canvas connections",
  productName: "Replica Hub",
  heading: "Canvas connections",
  description: "Review the repositories connected to your Copilot canvases.",
  emptyLabel: "No active connections.",
  backLabel: "Back to repositories",
  backPath: "/repositories",
  revokeLabel: "Revoke",
  notice: null,
  authenticityToken: "storybook-token",
  grants: [
    {
      id: 1,
      repository: "local/example",
      expiresLabel: "Expires October 1, 2026 at 12:00 UTC",
      revokePath: "/canvas/connections/1",
    },
  ],
}

const meta = {
  title: "Hub/Pages/Canvas/Connection",
  component: CanvasPairingsPage,
  args: { data: approval },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CanvasPairingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Approval: Story = {}

export const Connected: Story = { args: { data: connections } }

export const Multiple: Story = {
  args: {
    data: {
      ...connections,
      grants: [
        ...connections.grants,
        {
          id: 2,
          repository: "github/prototype",
          expiresLabel: "Expires October 2, 2026 at 12:00 UTC",
          revokePath: "/canvas/connections/2",
        },
      ],
    },
  },
}

export const ApprovedPending: Story = {
  args: {
    data: {
      ...connections,
      grants: [],
      notice: "Connection approved for local/example. Return to Copilot to finish connecting.",
    },
  },
}

export const Empty: Story = { args: { data: { ...connections, grants: [], notice: null } } }
