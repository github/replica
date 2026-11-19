export type BuildPackageFileKind = "dist" | "screenshot" | "manifest"

export interface BuildPackageFile {
  path: string
  kind: BuildPackageFileKind
  bytes: Buffer
}
