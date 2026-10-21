import { parseHubUrl } from "../parse-hub-url/index.mjs"

export function normalizeSelectedHubOrigin(value) {
  return parseHubUrl(value, "Hub URL").origin
}
