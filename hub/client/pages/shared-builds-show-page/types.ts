interface SharedBuildBase {
  frameTitle: string
  label: string
  pageTitle: string
  productName: string
  controlsIdentity?: string
  controlsOrigin?: string
}

export type SharedBuildsShowPageData = SharedBuildBase &
  (
    | { previewUrl: string; unavailable?: never }
    | { previewUrl?: never; unavailable: { heading: string; description: string } }
  )
