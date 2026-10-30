import type { PrototypeWorkspaceData } from "@features/prototype-workspace"
import type { ShareLinkData } from "@features/share-link-item/types"
import type { ShareLinksFormData } from "@features/share-links-form/types"

export interface ShareLinksIndexPageData extends PrototypeWorkspaceData {
  controlSettingsIdentity?: string
  controlSettingsCopy?: { label: string; description: string }
  alert: string | null
  copyErrorLabel: string
  copiedLabel: string
  copyLabel: string
  deleteLabel: string
  description: string
  emptyHeading: string
  emptyLabel: string
  form: ShareLinksFormData & { createPath: string }
  heading: string
  managementBuildNumber?: number
  noBuildHeading: string
  noBuildLabel: string
  notice: string | null
  mockNotice?: string
  openLabel: string
  pageTitle: string
  shareLinks: ShareLinkData[]
  publicSharingEnabled: boolean
  disabledLabel: string
  canManage?: boolean
  readOnlyLabel?: string
  openInNewTab?: boolean
  inactiveShareLinks?: Array<{
    id: number
    label: string
    stateLabel: string
    url: string
  }>
}
