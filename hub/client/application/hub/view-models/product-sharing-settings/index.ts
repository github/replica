import type { SharingSettingsPageData } from "@pages/sharing-settings-page/types"

import type { WorkspaceResponse } from "../../contracts"
import { routeIdentifierSchema } from "../../contracts"
import type { ProductSharingSettings } from "../../product-contracts"
import { ApiRequestError } from "../../requests/api-request-error"
import { resourcePath } from "../resource-path"
import { settingsWorkspace } from "../settings-workspace"

export function productSharingSettingsData(
  workspace: WorkspaceResponse,
  response: ProductSharingSettings,
  search: URLSearchParams,
): SharingSettingsPageData {
  const context = search.get("repositoryId")
  const parsed = context === null ? null : routeIdentifierSchema.safeParse(context)
  if (parsed && !parsed.success) {
    throw new ApiRequestError(400, "Invalid repository context.")
  }
  const repository = parsed?.success
    ? workspace.repositories.find(({ id }) => id === parsed.data)
    : workspace.repositories[0]
  if (context !== null && !repository) {
    throw new ApiRequestError(404, "Repository context not found.")
  }
  const navigation = settingsWorkspace(
    workspace,
    {
      repository: repository ?? null,
      session: {
        capabilities: workspace.capabilities
          ? {
              ...workspace.capabilities,
              administerHub: workspace.capabilities.administerHub && response.canAdminister,
            }
          : undefined,
      },
      welcomeHidden: workspace.navigation?.welcomeHidden ?? false,
      notifications: { unreadCount: workspace.navigation?.notificationsUnreadCount ?? 0 },
    },
    search,
    "sharing",
  )
  const sharingPath = resourcePath("/settings/sharing", search, {
    repositoryId: repository?.id ?? null,
  })
  const common = {
    heading: "Public sharing",
    description:
      "Control anonymous access to shared prototype Builds. This setting does not grant repository access.",
    auditLabel: "Security audit",
    auditPath: navigation.securityAuditPath ?? null,
    sharingSettingsLabel: "Public sharing",
    sharingSettingsPath: sharingPath,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    authenticityToken: "",
    notice: null,
    alert: null,
  }
  if (!response.canAdminister) {
    return {
      ...common,
      accessDenied: true,
      authenticatedWorkspace: navigation,
      emptyLabel: "Only Hub administrators can view or change deployment sharing settings.",
    }
  }
  return {
    ...common,
    administrationWorkspace: { ...navigation, selectedSection: "sharing" },
    accessDenied: false,
    emptyLabel:
      "No public access is permitted until a Hub administrator explicitly enables sharing.",
    statusLabel: response.enabled ? "Public sharing is enabled" : "Public sharing is disabled",
    operation: response.enabled ? "disable" : "enable",
    submitPath: sharingPath,
    submitLabel: response.enabled ? "Disable public sharing" : "Enable public sharing",
    consequence: response.enabled
      ? "All existing share links will be permanently revoked, including open previews and pending handoffs. Enabling later permits new links only."
      : "Anyone with a new share link can view its fixed Build without signing in. Previously revoked links stay revoked.",
    confirmLabel: "I understand and confirm this deployment-wide change.",
    verification:
      "This change requires GitHub verification within the last five minutes on this browser. If verification is required, Hub continues your confirmed change after it succeeds.",
  }
}
