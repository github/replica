export function withViewMode(address: string, showChrome: boolean): string {
  const url = new URL(address, window.location.href)
  url.searchParams.delete("view")
  if (!showChrome) url.searchParams.append("view", "minimized")
  return url.toString()
}
