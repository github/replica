import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("copilot", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("copilot", loaderData)
}

export default function SettingsCopilotRoute({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="copilot" data={loaderData} />
}
