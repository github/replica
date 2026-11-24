import { privatePreviewAddress } from "../private-preview-address/index.ts"

export function readPrivatePreviewAddress(path: string) {
  const match = /^\/previews\/github\/([^/]+)\/([^/]+)\/(.*)$/.exec(path)
  if (!match) return null
  const address = privatePreviewAddress(match[1]!, match[2]!)
  return address && { address, relativePath: match[3]! }
}
