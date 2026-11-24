import type { SharingSettingsPageData } from "@pages/sharing-settings-page/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { ProductSharingSettings } from "@application/hub/product-contracts/types"

import { hubWorkspace } from "../hub-workspace"
import { resourcePath } from "../resource-path"

export function productSharingSettingsData(
  workspace: WorkspaceResponse,
  response: ProductSharingSettings,
  search: URLSearchParams,
): SharingSettingsPageData {
  const capabilities = workspace.capabilities
    ? {
        ...workspace.capabilities,
        administerHub: workspace.capabilities.administerHub && response.canAdminister,
      }
    : undefined
  const navigation = hubWorkspace({ ...workspace, capabilities }, search, "sharing")
  const sharingPath = resourcePath("/settings/sharing", {
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
    signOutPath: "/api/auth/session/sign-out",
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
