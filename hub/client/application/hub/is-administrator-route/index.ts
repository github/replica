export function isAdministratorRoute(request: Request) {
  const pathname = new URL(request.url).pathname.toLowerCase().replace(/\/+$/, "")
  return (
    pathname === "/settings/administrators" ||
    pathname.startsWith("/settings/administrators/") ||
    pathname === "/settings/admins" ||
    pathname.startsWith("/settings/admins/") ||
    pathname === "/settings/audit"
  )
}
