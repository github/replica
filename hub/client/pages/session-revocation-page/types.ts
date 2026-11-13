import type { HubAdministrationPageData } from "@features/hub-administration-page/types"

export interface SessionRevocationPageData extends HubAdministrationPageData {
  pageTitle: string
  canRevoke: boolean
  scope: string
  ownSession: string | null
  verification: string
  counts: string | null
  emptyLabel: string | null
  confirmLabel: string | null
  authorizationId?: string | null
  submitLabel: string
  cancelLabel: string
  submitPath: string
  signInLabel: string
  signInPath: string
}
