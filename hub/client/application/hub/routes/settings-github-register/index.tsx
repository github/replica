import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("github-register", "public")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("github-register", loaderData)
}

export default function SettingsGithubRegister({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="github-register" data={loaderData} />
}
