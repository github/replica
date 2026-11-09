import type { HubAdminsPageData } from "@pages/hub-admins-page/types"
import type {
  AdministratorsResponse,
  CurrentHubSession,
} from "@application/hub/administrator-contracts/types"

import { administratorWorkspace } from "../administrator-workspace"
import { administratorProviderLabel } from "../administrator-provider-label"

export function administratorsPageData(
  session: CurrentHubSession,
  response: AdministratorsResponse,
  before?: string,
  notice: string | null = null,
): HubAdminsPageData {
  return {
    administrationWorkspace: administratorWorkspace(session),
    heading: "Hub administrators",
    description:
      "Hub administrators can manage this deployment and read its security records. This role never grants access to repositories.",
    auditLabel: "Security audit",
    auditPath: null,
    repositoriesLabel: "Home",
    repositoriesPath: "/",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    authenticityToken: "",
    notice,
    alert: null,
    pageTitle: "Hub administrators",
    emptyLabel: "No Hub administrators are available.",
    nextLabel: "Next page",
    nextPath: response.nextCursor
      ? `/settings/administrators?before=${encodeURIComponent(response.nextCursor)}`
      : null,
    addLabel: "Add administrator",
    administratorsLabel: `${response.administrators.length} ${
      response.administrators.length === 1 ? "administrator" : "administrators"
    } on this page`,
    addAdministrator: {
      submitPath: "/api/administrators/authorizations/start",
      operation: "DESIGNATE_ADMINISTRATORS",
      heading: "Add administrator",
      description:
        "Select existing Hub users to give them administrator controls and access to deployment security records. Their repository permissions will not change.",
      searchLabel: "Search Hub users",
      searchPlaceholder: "Search by name or login",
      loadingLabel: "Enter a name or login to search Hub users.",
      emptyLabel: "No matching Hub users are available.",
      moreLabel: "Showing the first 50 matches. Refine your search to find other users.",
      selectedLabel: "Selected users",
      confirmLabel: "I confirm adding the selected users as Hub administrators.",
      submitLabel: "Add selected administrators",
      searchFailedLabel: "Hub could not search users. Try again. No role changes were made.",
      retryLabel: "Try again",
      cancelLabel: "Cancel",
    },
    users: response.administrators.map((administrator) => ({
      id: administrator.membershipId,
      provider: administrator.provider,
      login: administrator.login,
      name: administrator.name,
      identity: administratorProviderLabel(administrator.provider),
      role: "Hub administrator",
      actionLabel: "Remove administrator",
      confirmationPath: `/settings/administrators/${administrator.membershipId}/revoke${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    })),
  }
}
