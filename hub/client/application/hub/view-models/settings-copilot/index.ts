import type { CopilotConnectionPageData } from "@pages/copilot-connection-page/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { SettingsWorkspaceResponse } from "@application/hub/settings-contracts/types"

import { resourcePath } from "../resource-path"
import { settingsAdministration } from "../settings-administration"

export function settingsCopilot(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): CopilotConnectionPageData {
  const shared = {
    ...settingsAdministration(
      workspace,
      state,
      search,
      "copilot",
      "Copilot",
      "A Hub administrator connects Copilot once for the whole Hub. Hub then asks Copilot to suggest learnings from prototype review comments, with a token that the person who runs Hub provides, so it works while everyone is signed out.",
    ),
    emptyLabel: "Learnings stays off until a Hub administrator connects Copilot.",
  }
  if (!state.session.capabilities.administerHub) return { ...shared, accessDenied: true }
  const verification =
    "This change requires GitHub verification within the last five minutes on this browser. If verification is required, Hub continues your confirmed change after it succeeds."
  return {
    ...shared,
    accessDenied: false,
    connected: state.copilot.connected,
    statusLabel: state.copilot.connected ? "Copilot is connected" : "Copilot is not connected",
    submitPath: resourcePath("/settings/copilot", search),
    tokenLabel: null,
    connectedBy: state.copilot.connectedBy
      ? `@${state.copilot.connectedBy} connected Copilot.`
      : undefined,
    refusedLabel: null,
    connect: state.copilot.connected
      ? null
      : {
          label: "Connect Copilot",
          consequence:
            "Hub will ask Copilot, with the configured token, to read new review comments from every repository on this Hub and suggest learnings, including while you are signed out. Copilot never sees who wrote a comment. The usage counts toward the Copilot plan of the token's owner. Hub checks the token with Copilot first, and never stores or shows it.",
          confirmLabel: "I understand that Hub will use this Copilot token for this Hub.",
          verification,
        },
    disconnect: state.copilot.connected
      ? {
          label: "Disconnect Copilot",
          consequence:
            "Hub stops looking for learnings and turns off Learnings for every repository. Hub keeps every learning and decision, so connecting again restores them. The token stays where the person who runs Hub keeps it; they can revoke it on GitHub.",
          confirmLabel: "I understand and confirm disconnecting Copilot for this Hub.",
          verification,
        }
      : undefined,
  }
}
