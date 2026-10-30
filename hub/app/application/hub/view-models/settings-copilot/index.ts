import type { CopilotConnectionPageData } from "@pages/copilot-connection-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
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
      "Try a simulated connection and fake learning runs. No provider, token or account is used.",
    ),
    emptyLabel: "The Copilot simulation is disconnected.",
  }
  if (!state.session.capabilities.administerHub) return { ...shared, accessDenied: true }
  const verification = "The next page is a local confirmation, not GitHub authorization."
  return {
    ...shared,
    accessDenied: false,
    connected: state.copilot.connected,
    statusLabel: state.copilot.connected ? "Simulation connected" : "Simulation disconnected",
    submitPath: resourcePath("/settings/copilot", search),
    tokenLabel: null,
    connectedBy: state.copilot.connectedBy
      ? `Mock connection confirmed by @${state.copilot.connectedBy}.`
      : undefined,
    verifiedLabel: "No provider verification was attempted.",
    usageLabel: "No tokens, requests or credits are used.",
    refusedLabel: null,
    connect: state.copilot.connected
      ? null
      : {
          label: "Connect simulation",
          consequence: "This enables local fake-run controls only. It starts no learning run.",
          confirmLabel: "I understand this is a simulation with no provider connection.",
          verification,
        },
    disconnect: state.copilot.connected
      ? {
          label: "Disconnect simulation",
          consequence: "Fake-run controls stop. Existing mock learnings remain available.",
          confirmLabel: "Disconnect the local simulation.",
          verification,
        }
      : undefined,
  }
}
