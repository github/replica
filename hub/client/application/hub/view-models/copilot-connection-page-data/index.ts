import type { CopilotConnectionPageData } from "@pages/copilot-connection-page/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import type { CopilotConnectionStatus } from "@application/hub/copilot-connection-contracts/types"

import { administratorWorkspace } from "../administrator-workspace"

export function copilotConnectionPageData(
  session: CurrentHubSession,
  status: CopilotConnectionStatus,
): CopilotConnectionPageData {
  const verification =
    "Hub checks your live administrator session again after Copilot answers, before saving the change."
  return {
    administrationWorkspace: {
      ...administratorWorkspace(session),
      selectedSection: "copilot",
    },
    heading: "Copilot",
    description:
      "A Hub administrator connects Copilot once for this deployment. The operator-provided credential stays outside the database.",
    auditLabel: "Security audit",
    auditPath: "/settings/audit?scope=hub",
    repositoriesLabel: "Home",
    repositoriesPath: "/",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    authenticityToken: "",
    notice: null,
    alert: null,
    emptyLabel: "Learnings stays off until a Hub administrator connects Copilot.",
    accessDenied: false,
    connected: status.connected,
    statusLabel: status.connected ? "Copilot is connected" : "Copilot is not connected",
    submitPath: "/settings/copilot",
    credentialLabel: status.configured
      ? null
      : "Configure a Copilot credential provider before connecting. Simple deployments can explicitly select ambient CLI authentication or the environment-token provider.",
    connectedBy: status.connectedBy
      ? `${status.connectedBy.login ? `@${status.connectedBy.login}` : "A Hub administrator"} connected Copilot. Membership ${status.connectedBy.membershipId}.`
      : undefined,
    verifiedLabel: status.verifiedAt
      ? `Copilot last answered on ${new Date(status.verifiedAt).toISOString()}.`
      : undefined,
    refusedLabel: status.refusedAt
      ? `Copilot refused the configured credential on ${new Date(status.refusedAt).toISOString()}.`
      : null,
    connect:
      status.connected || !status.configured
        ? null
        : {
            label: status.verifiedAt ? "Check and connect Copilot" : "Connect Copilot",
            consequence:
              "Hub asks Copilot to verify the configured credential. Later learning runs may send review comment text without reviewer identity. GitHub attributes usage to the account or organization represented by that credential.",
            confirmLabel: "I understand and confirm connecting Copilot for this Hub.",
            verification,
          },
    disconnect: status.connected
      ? {
          label: "Disconnect Copilot",
          consequence:
            "Hub stops new Copilot-backed learning work. Existing learning stores and decisions remain unchanged.",
          confirmLabel: "I understand and confirm disconnecting Copilot for this Hub.",
          verification,
        }
      : undefined,
  }
}
