import { redirect } from "react-router"

import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const controller = settingsController("admins", "workspace")

export async function clientLoader(args: Parameters<typeof controller.clientLoader>[0]) {
  if (!(import.meta.env.DEV && import.meta.env.MODE === "mock")) {
    const url = new URL(args.request.url)
    throw redirect(`/settings/administrators${url.search}`)
  }
  return controller.clientLoader(args)
}

export const clientAction = controller.clientAction

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("admins", loaderData)
}

export default function SettingsAdmins({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="admins" data={loaderData} />
}
