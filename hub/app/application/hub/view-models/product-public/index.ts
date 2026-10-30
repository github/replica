import type { SharedBuildsShowPageData } from "@pages/shared-builds-show-page/types"

import type { ProductPublicResponse } from "../../product-contracts"

export function productPublicData(response: ProductPublicResponse): SharedBuildsShowPageData {
  const common = {
    frameTitle: response.label,
    label: response.label,
    pageTitle: `${response.label} · Shared prototype`,
    productName: "Replica Hub",
    mockNotice: "Synthetic local shared preview. No Build was hosted or published.",
  }
  if (response.state === "active") {
    return {
      ...common,
      frameTitle: `${response.prototypeName} · Build ${response.buildNumber}`,
      previewUrl: response.previewUrl,
    }
  }
  const feedback = {
    expired: {
      heading: "This link has expired",
      description: "Ask the prototype owner for a new local share link.",
    },
    revoked: {
      heading: "This link was revoked",
      description: "This local link cannot be restored. Ask the owner for a new link.",
    },
    disabled: {
      heading: "Public sharing is disabled",
      description: "This mock Hub does not currently allow shared previews.",
    },
  }
  return { ...common, unavailable: feedback[response.state] }
}
