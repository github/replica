export function createBuildPreviewOrigin(buildId: string, previewBaseOrigin: string): string {
  const base = new URL(previewBaseOrigin)
  base.hostname = `${buildId.toLowerCase()}.${base.hostname}`
  return base.origin
}
