import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("sessions", "public")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("sessions", loaderData)
}

export default function SettingsSessions({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="sessions" data={loaderData} />
}
