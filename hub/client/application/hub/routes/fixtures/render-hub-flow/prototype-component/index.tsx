import { useLoaderData } from "react-router"

import type { clientLoader as loadPrototype } from "@application/hub/routes/prototype"
import PrototypeRoute from "@application/hub/routes/prototype"

export function PrototypeComponent() {
  return <PrototypeRoute loaderData={useLoaderData<typeof loadPrototype>()} />
}
