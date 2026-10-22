import { parseHubUrl } from "../parse-hub-url/index.mjs"

export function normalizeSelectedHubOrigin(value: string) {
  return parseHubUrl(value, "Hub URL").origin
}
