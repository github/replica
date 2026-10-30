export interface ReviewConfirmationPanelProps {
  cancelLabel: string
  confirmLabel: string
  description: string
  errorLabel?: string
  heading: string
  loading?: boolean
  loadingAnnouncement?: string
  compact?: boolean
  condensed?: boolean
  onCancel: () => void
  onConfirm: () => void
}
