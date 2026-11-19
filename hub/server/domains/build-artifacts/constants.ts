export const maximumBuildPackageEntries = 2_090
export const maximumDistFiles = 2_000
export const maximumDistFileBytes = 25 * 1024 * 1024
export const maximumDistPathDepth = 20
export const maximumScreenshotBytes = 25 * 1024 * 1024
export const maximumExtractedBytes = 100 * 1024 * 1024
export const maximumTemplateManifestBytes = 16 * 1024
export const screenshotPathPattern =
  /^screenshots\/(?:templates\/[a-z0-9]+(?:-[a-z0-9]+)*\/)?(?:desktop|narrow)(?:-dark)?\.png$/
export const distDigestPattern = /^sha256:[0-9a-f]{64}$/
export const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
