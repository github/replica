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

export const TaskApproval: Story = {
  args: {
    data: {
      ...approval,
      pageTitle: "Approve prototype task",
      heading: "Approve prototype task",
      description: "Give this task permission to publish one prototype branch.",
      codeInstruction:
        "Only approve if this code, repository and branch match the request in your Copilot conversation.",
      repository: "github/prototype",
      branch: "prototype/welcome",
      branchLabel: "Branch",
      approvalDeadline:
        "This request must be approved and connected by December 1, 2026 at 10:00 UTC.",
      permissions:
        "The task can register this branch and read its publication status. Approval includes follow-up commits on this branch, but no other branches. It does not allow public sharing, screenshots, review changes or Hub administration. Your approval is recorded separately from the task's registration identity.",
      learningsConsentVersion: undefined,
      expiration:
        "Access expires 24 hours after approval. Follow-up commits and automatic requests never extend it. Hub checks your current repository write access before each operation. Review the exact expiry and revoke access from",
      connectionsLabel: "Prototype task connections",
      connectionsPath: "/tasks/connections",
      approveLabel: "Approve task",
      approvePath: "/tasks/approve/ABCDEF1234",
      cancelLabel: "Deny request",
      cancelPath: "/tasks/approve/ABCDEF1234",
      cancelMethod: "delete",
    },
  },
}

const taskConnections: CanvasPairingsPageData = {
  ...connections,
  pageTitle: "Prototype task connections",
  heading: "Prototype task connections",
  description:
    "Approved tasks can publish follow-up commits on their listed branch until expiry. Revoking a connection stops future access without deleting published Builds.",
  emptyLabel: "No active task connections.",
  grants: [
    {
      id: 1,
      repository: "github/prototype",
      branch: "prototype/welcome",
      expiresLabel: "Expires December 2, 2026 at 10:00 UTC. This deadline does not extend.",
      revokePath: "/tasks/connections/1",
    },
  ],
}

export const TaskConnections: Story = { args: { data: taskConnections } }

export const TaskConnectionsMultiple: Story = {
  args: {
    data: {
      ...taskConnections,
      grants: [
        ...taskConnections.grants,
        {
          id: 2,
          repository: "github/prototype",
          branch: "prototype/navigation",
          expiresLabel: "Expires December 2, 2026 at 12:00 UTC. This deadline does not extend.",
          revokePath: "/tasks/connections/2",
        },
      ],
    },
  },
}

export const TaskConnectionsEmpty: Story = {
  args: { data: { ...taskConnections, grants: [] } },
}

export const TaskApprovedPending: Story = {
  args: {
    data: {
      ...taskConnections,
      notice: "Task approved. Return to Copilot to finish connecting before the request deadline.",
    },
  },
}
