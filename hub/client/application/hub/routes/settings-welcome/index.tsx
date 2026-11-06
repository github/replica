import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("welcome", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("welcome", loaderData)
}

export default function SettingsWelcome({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="welcome" data={loaderData} />
}
