import { useLoaderData } from "react-router"

import type { clientLoader as loadHome } from "@application/hub/routes/home"
import HomeRoute from "@application/hub/routes/home"

export function HomeComponent() {
  return <HomeRoute loaderData={useLoaderData<typeof loadHome>()} />
}
