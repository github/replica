import { useLoaderData } from "react-router"

import type { clientLoader as loadBuildHistory } from "@application/hub/routes/build-history"
import BuildHistoryRoute from "@application/hub/routes/build-history"

export function BuildHistoryComponent() {
  return <BuildHistoryRoute loaderData={useLoaderData<typeof loadBuildHistory>()} />
}
