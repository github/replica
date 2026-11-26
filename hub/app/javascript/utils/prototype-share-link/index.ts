export function prototypeShareLink(address: string, build: number | "latest"): string {
  const url = new URL(address, window.location.href)
  url.searchParams.set("build", String(build))
  return url.toString()
}
