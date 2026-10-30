import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("github-setup", "public")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("github-setup", loaderData)
}

export default function SettingsGithubSetupRoute({
  loaderData,
}: {
  loaderData: SettingsRouteData
}) {
  return <SettingsRouteScreen section="github-setup" data={loaderData} />
}
