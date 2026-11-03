import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"

export function settingsCanvas(
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  approval: boolean,
): CanvasPairingsPageData {
  const shared = {
    productName: "Replica Hub",
    authenticityToken: "",
    pageTitle: approval ? "Connect Replica canvas" : "Canvas connections",
    heading: approval ? "Connect Replica canvas" : "Canvas connections",
    description: approval
      ? "Confirm this connection before letting Copilot access your Hub reviews."
      : "Review the repositories connected to your Copilot canvases.",
  }
  if (approval) {
    if (!state.repository) throw new Error("A canvas approval needs a selected repository.")
    return {
      ...shared,
      kind: "approval",
      canApprove: state.session.capabilities.manageSharing,
      code: state.canvasApproval.code,
      codeLabel: "Connection code",
      codeInstruction: "Only approve if this code matches the one shown in your Copilot canvas.",
      repository: state.repository.nameWithOwner,
      repositoryLabel: "Repository",
      permissions: state.session.capabilities.manageSharing
        ? "The canvas can read Build details and review conversations, edit prototype details, and participate in conversations with your Hub account. It can create review threads when the local checkout matches an imported Build. The connection also lets Copilot add the learnings this repository's administrators accepted to your prompts."
        : "You do not have permission to approve a connection for this repository.",
      learningsConsentVersion: state.canvasApproval.consentVersion,
      expiration:
        "Connections expire after seven days. Hub checks your current repository access on every request. You can revoke access from",
      connectionsLabel: "Canvas connections",
      connectionsPath: resourcePath("/settings/canvas", search),
      approveLabel: "Approve connection",
      approvePath: resourcePath("/settings/canvas/approve", search, {
        repositoryId: state.repository.id,
      }),
      cancelLabel: "Cancel",
      cancelPath: resourcePath("/settings/canvas", search),
    }
  }
  return {
    ...shared,
    kind: "connections",
    createLabel: "Connect canvas",
    createPath: state.repository
      ? resourcePath("/settings/canvas/approve", search, { repositoryId: state.repository.id })
      : null,
    emptyLabel: "No active connections.",
    backLabel: "Back to repositories",
    backPath: "/",
    revokeLabel: "Revoke",
    notice: null,
    grants: state.grants.map((grant) => ({
      id: grant.id,
      repository: grant.repository,
      expiresLabel: `Expires ${new Date(grant.expiresAt).toLocaleString()}`,
      revokePath: resourcePath("/settings/canvas", search, { grantId: grant.id }),
    })),
  }
}
