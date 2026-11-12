import type { HubWorkspaceData } from "@features/hub-workspace/types"

export interface HubAdministrationWorkspaceData extends HubWorkspaceData {
  selectedSection: "audit" | "admins" | "sharing" | "sessions" | "github" | "copilot"
}
