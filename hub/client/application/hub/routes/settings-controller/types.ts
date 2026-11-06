import type {
  SettingsPublicResponse,
  SettingsCandidateResponse,
  SettingsQuery,
  SettingsWorkspaceResponse,
} from "../../settings-contracts/types"

export type SettingsRouteData =
  | { surface: "public"; state: SettingsPublicResponse; query: SettingsQuery }
  | {
      surface: "workspace"
      state: SettingsWorkspaceResponse
      query: SettingsQuery
      confirmation?: {
        userId: number
        user: SettingsCandidateResponse["users"][number]
        operation: "designate" | "revoke"
      }
    }
