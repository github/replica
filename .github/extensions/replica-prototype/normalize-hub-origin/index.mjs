import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"
import { parseHubUrl } from "../parse-hub-url/index.mjs"

export function normalizeHubOrigin(value, name = "REPLICA_HUB_ORIGIN") {
  const origin = parseHubUrl(value, name)
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new InvalidHubOrigin(`${name} must be an HTTP or HTTPS origin without credentials.`)
  }
  return origin.origin
}
