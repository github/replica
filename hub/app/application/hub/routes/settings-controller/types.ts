import type {
  SettingsPublicResponse,
  SettingsQuery,
  SettingsWorkspaceResponse,
} from "../../settings-contracts"

export type SettingsRouteData =
  | { surface: "public"; state: SettingsPublicResponse; query: SettingsQuery }
  | {
      surface: "workspace"
      state: SettingsWorkspaceResponse
      query: SettingsQuery
      confirmation?: { userId: number; operation: "designate" | "revoke" }
    }
