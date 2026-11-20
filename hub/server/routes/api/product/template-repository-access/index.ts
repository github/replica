import type { ProductViewer } from "../types.ts"

export function canBrowseTemplates(viewer: ProductViewer, local: boolean) {
  return local
    ? viewer.sessionProvider === "local" && viewer.role === "ADMINISTRATOR"
    : viewer.sessionProvider !== "local" && viewer.sessionProvider !== null
}
