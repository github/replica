import type { SharingSettingsPageData } from "@pages/sharing-settings-page/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { recordIdentifierSchema } from "@application/hub/contracts"
import type { ProductSharingSettings } from "@application/hub/product-contracts/types"
import { ApiRequestError } from "@application/hub/requests/api-request-error"

import { hubWorkspace } from "../hub-workspace"
import { resourcePath } from "../resource-path"
import { settingsWorkspace } from "../settings-workspace"

export function productSharingSettingsData(
  workspace: WorkspaceResponse,
  response: ProductSharingSettings,
  search: URLSearchParams,
  real = false,
): SharingSettingsPageData {
  const capabilities = workspace.capabilities
    ? {
        ...workspace.capabilities,
        administerHub: workspace.capabilities.administerHub && response.canAdminister,
      }
    : undefined
  function mockNavigation() {
    const context = search.get("repositoryId")
    const parsed = context === null ? null : recordIdentifierSchema.safeParse(context)
    if (parsed && !parsed.success) throw new ApiRequestError(400, "Invalid repository context.")
    const repository = parsed?.success
      ? workspace.repositories.find(({ id }) => id === parsed.data)
      : workspace.repositories[0]
    if (context !== null && !repository)
      throw new ApiRequestError(404, "Repository context not found.")
    return settingsWorkspace(
      workspace,
      {
        repository: repository ?? null,
        session: { capabilities },
        welcomeHidden: workspace.navigation?.welcomeHidden ?? false,
        notifications: { unreadCount: workspace.navigation?.notificationsUnreadCount ?? 0 },
      },
      search,
      "sharing",
    )
  }
  const navigation = real
    ? hubWorkspace({ ...workspace, capabilities }, search, "sharing")
    : mockNavigation()
  const sharingPath = resourcePath("/settings/sharing", search, {
    repositoryId: navigation.repository?.selectedRepositoryId ?? null,
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
    signOutPath: real ? "/api/auth/session/sign-out" : "/session",
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
      "Hub checks your current administrator session again before applying this deployment-wide change.",
  }
}
