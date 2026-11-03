import type { SharedBuildsShowPageData } from "@pages/shared-builds-show-page/types"

import type { ProductPublicResponse } from "../../product-contracts"

export function productPublicData(response: ProductPublicResponse): SharedBuildsShowPageData {
  const common = {
    frameTitle: response.label,
    label: response.label,
    pageTitle: `${response.label} · Shared prototype`,
    productName: "Replica Hub",
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
      description: "Ask the prototype owner for a new share link.",
    },
    revoked: {
      heading: "This link was revoked",
      description: "This link cannot be restored. Ask the owner for a new link.",
    },
    disabled: {
      heading: "Public sharing is disabled",
      description: "This Hub does not currently allow shared previews.",
    },
  }
  return { ...common, unavailable: feedback[response.state] }
}
