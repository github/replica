export function withViewMode(address: string, fullScreenPreview: boolean): string {
  const url = new URL(address, window.location.href)
  url.searchParams.delete("view")
  if (fullScreenPreview) url.searchParams.append("view", "minimized")
  return url.toString()
}
