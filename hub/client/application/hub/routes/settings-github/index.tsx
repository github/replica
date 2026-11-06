import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("github", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("github", loaderData)
}

export default function SettingsGithub({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="github" data={loaderData} />
}
