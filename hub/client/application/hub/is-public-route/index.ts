export function isPublicRoute(request: Request): boolean {
  if (import.meta.env.DEV && import.meta.env.MODE === "mock") return false
  const { pathname } = new URL(request.url)
  return pathname === "/" || pathname === "/admin-enrollment" || pathname.startsWith("/shared/")
}
