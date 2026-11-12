import { useLoaderData } from "react-router"

import type { clientLoader as loadSession } from "@application/hub/root"
import HubRoot from "@application/hub/root"
import MockToolbar from "@application/hub/mocks/mock-toolbar"

export function RootComponent({ withTools = false }: { withTools?: boolean }) {
  const session = useLoaderData<typeof loadSession>()
  return (
    <>
      {withTools ? <MockToolbar /> : null}
      <HubRoot loaderData={session} />
    </>
  )
}
