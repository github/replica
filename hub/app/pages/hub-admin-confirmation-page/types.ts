import type { HubAdministrationPageData } from "@features/hub-administration-page/types"

export interface HubAdminConfirmationPageData extends HubAdministrationPageData {
  pageTitle: string
  target: { login: string; name: string | null; identity: string }
  operation: "designate" | "revoke"
  submitPath: string
  submitLabel: string
  confirmLabel: string
  cancelLabel: string
  cancelPath: string
  verification: string
  blockedLabel: string | null
}
