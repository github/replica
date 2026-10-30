import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"

export function settingsCanvas(
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  approval: boolean,
): CanvasPairingsPageData {
  const shared = {
    simulation: true,
    productName: "Replica Hub",
    authenticityToken: "",
    pageTitle: approval ? "Mock canvas approval" : "Mock canvas connections",
    heading: approval ? "Simulate a canvas connection" : "Canvas connections",
    description:
      "This is a local simulation. No Copilot canvas, credentials, or external account is connected.",
  }
  if (approval) {
    if (!state.repository) throw new Error("A mock canvas approval needs a selected repository.")
    return {
      ...shared,
      kind: "approval",
      canApprove: state.session.capabilities.manageSharing,
      code: "MOCK-1234",
      codeLabel: "Synthetic code — not a credential",
      codeInstruction:
        "This fixed code demonstrates approval only. Do not enter a real connection code.",
      repository: state.repository.nameWithOwner,
      repositoryLabel: "Mock repository",
      permissions: state.session.capabilities.manageSharing
        ? "Approval adds one local fixture record. It grants no real access."
        : "This read-only mock profile cannot approve a connection.",
      learningsConsentVersion: "mock-v1",
      expiration: "The fixture displays a seven-day expiry. You can remove it from",
      connectionsLabel: "Mock canvas connections",
      connectionsPath: resourcePath("/settings/canvas", search),
      approveLabel: "Approve simulation",
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
    createLabel: "Try a mock approval",
    createPath: state.repository
      ? resourcePath("/settings/canvas/approve", search, { repositoryId: state.repository.id })
      : null,
    emptyLabel: "No simulated canvas connections.",
    backLabel: "Back to repositories",
    backPath: "/",
    revokeLabel: "Revoke simulation",
    notice: null,
    grants: state.grants.map((grant) => ({
      id: grant.id,
      repository: grant.repository,
      expiresLabel: `Mock expiry: ${grant.expiresAt}`,
      revokePath: resourcePath("/settings/canvas", search, { grantId: grant.id }),
    })),
  }
}
