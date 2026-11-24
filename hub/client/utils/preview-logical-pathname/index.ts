/** Remove only the mount reported by the selected preview document. */
export function previewLogicalPathname(pathname: string, mount?: string | null): string {
  if (!mount) return pathname
  if (pathname === mount.slice(0, -1)) return "/"
  return pathname.startsWith(mount) ? `/${pathname.slice(mount.length)}` : pathname
}
