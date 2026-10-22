import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"

export function parseHubUrl(value, name) {
  let origin
  try {
    origin = new URL(value)
  } catch {
    throw new InvalidHubOrigin(`${name} must be an HTTP or HTTPS origin without credentials.`)
  }
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new InvalidHubOrigin(`${name} must be an HTTP or HTTPS origin without credentials.`)
  }
  if (
    origin.protocol === "http:" &&
    origin.hostname !== "localhost" &&
    origin.hostname !== "127.0.0.1" &&
    !origin.hostname.endsWith(".localhost")
  ) {
    throw new InvalidHubOrigin("Remote Replica Hub connections require HTTPS.")
  }
  return origin
}
