export interface WorkflowInstallationData {
  actionLabel?: string
  createPath?: string
  description: string
  documentationLabel?: string
  documentationUrl?: string
  heading: string
  state: "installable" | "requiresWriter" | "unavailable" | "updatable"
}
