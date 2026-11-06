import type { ReactNode, Ref } from "react"

export interface ShareLinksContentLabels {
  heading: string
  description?: string
  noBuildHeading: string
  noBuildLabel: string
  emptyHeading: string
  emptyLabel: string
}

export interface ShareLinksContentProps {
  labels: ShareLinksContentLabels
  headingRef?: Ref<HTMLHeadingElement>
  headingTrailing?: ReactNode
  feedback?: ReactNode
  form?: ReactNode
  formUnavailable?: ReactNode
  links: ReactNode
  hasLinks: boolean
  showEmpty?: boolean
  listRef?: Ref<HTMLUListElement>
  listBusy?: boolean
  beforeLinks?: ReactNode
  afterLinks?: ReactNode
}
