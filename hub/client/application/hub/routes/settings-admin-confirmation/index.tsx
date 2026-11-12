import { redirect } from "react-router"
import { z } from "zod"

import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const controller = settingsController("admin-confirmation", "workspace")
const parametersSchema = z.object({
  userId: z.uuid(),
  operation: z.enum(["designate", "revoke"]),
})

export async function clientLoader(args: Parameters<typeof controller.clientLoader>[0]) {
  if (!(import.meta.env.DEV && import.meta.env.MODE === "mock")) {
    const parameters = parametersSchema.safeParse(args.params)
    if (!parameters.success) {
      throw new Response("This administrator role change is invalid.", { status: 400 })
    }
    const url = new URL(args.request.url)
    throw redirect(
      `/settings/administrators/${parameters.data.userId}/${parameters.data.operation}${url.search}`,
    )
  }
  return controller.clientLoader(args)
}

export const clientAction = controller.clientAction

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("admin-confirmation", loaderData)
}

export default function SettingsAdminConfirmation({
  loaderData,
}: {
  loaderData: SettingsRouteData
}) {
  return <SettingsRouteScreen section="admin-confirmation" data={loaderData} />
}
