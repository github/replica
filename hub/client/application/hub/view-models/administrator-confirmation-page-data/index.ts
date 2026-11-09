import type { HubAdminConfirmationPageData } from "@pages/hub-admin-confirmation-page/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"

import { administratorWorkspace } from "../administrator-workspace"
import { administratorProviderLabel } from "../administrator-provider-label"

export function administratorConfirmationPageData(
  session: CurrentHubSession,
  target: {
    membershipId: string
    provider: string
    login: string
    name: string | null
  },
  operation: "designate" | "revoke",
  blockedLabel: string | null,
): HubAdminConfirmationPageData {
  const designating = operation === "designate"
  return {
    administrationWorkspace: administratorWorkspace(session),
    heading: designating ? "Designate Hub administrator?" : "Remove Hub administrator?",
    description: designating
      ? "This user will be able to designate and remove Hub administrators and read deployment security records. Their repository permissions will not change."
      : "This user will lose Hub administrator controls and deployment security records. Their repository permissions will not change. Removing your own role takes effect immediately.",
    auditLabel: "Security audit",
    auditPath: null,
    repositoriesLabel: "Home",
    repositoriesPath: "/",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    authenticityToken: "",
    notice: null,
    alert: null,
    pageTitle: designating ? "Designate Hub administrator?" : "Remove Hub administrator?",
    target: {
      login: target.login,
      name: target.name,
      identity: administratorProviderLabel(target.provider),
    },
    operation: designating ? "DESIGNATE_ADMINISTRATORS" : "REVOKE_ADMINISTRATOR",
    targetMembershipId: target.membershipId,
    submitPath: "/api/administrators/authorizations/start",
    submitLabel: designating ? "Designate administrator" : "Remove administrator",
    confirmLabel: "I confirm this Hub administrator role change.",
    cancelLabel: "Cancel",
    cancelPath: "/settings/administrators",
    verification:
      "Hub will ask the provider for this session to verify the same account before continuing the confirmed role change.",
    blockedLabel,
  }
}
