import type { HubAdministrationPageData } from "@features/hub-administration-page/types"
import type { AddHubAdministratorsData } from "@features/add-hub-administrators/types"

export interface HubAdminsPageData extends HubAdministrationPageData {
  pageTitle: string
  emptyLabel: string
  nextLabel: string
  nextPath: string | null
  addLabel: string
  administratorsLabel: string | null
  addAdministrator: AddHubAdministratorsData | null
  users: {
    id: number
    login: string
    name: string | null
    identity: string
    role: string
    actionLabel: string
    confirmationPath: string
  }[]
}
