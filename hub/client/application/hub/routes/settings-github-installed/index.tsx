import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("github-installed", "public")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("github-installed", loaderData)
}

export default function SettingsGithubInstalledRoute({
  loaderData,
}: {
  loaderData: SettingsRouteData
}) {
  return <SettingsRouteScreen section="github-installed" data={loaderData} />
}
