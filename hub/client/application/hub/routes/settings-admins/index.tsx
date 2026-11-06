import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("admins", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("admins", loaderData)
}

export default function SettingsAdmins({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="admins" data={loaderData} />
}
