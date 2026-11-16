export interface LocalBuildPackageFile {
  path: string
  kind: "dist" | "screenshot" | "manifest"
  bytes: Uint8Array
}
