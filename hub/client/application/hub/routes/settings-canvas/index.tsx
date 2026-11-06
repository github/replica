import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("canvas", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("canvas", loaderData)
}

export default function SettingsCanvas({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="canvas" data={loaderData} />
}
