import type { ReactNode, Ref } from "react"

export type HubSidebarProps = {
  title: string
  label?: string
  open: boolean
  closeLabel: string
  closeDisabled?: boolean
  closeShortcut?: string
  closeRef?: Ref<HTMLButtonElement>
  onClose: () => void
  headerAccessory?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}
