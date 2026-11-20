export function isAdministratorRoute(url: URL) {
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, "")
  return (
    pathname === "/settings/administrators" ||
    pathname.startsWith("/settings/administrators/") ||
    pathname === "/settings/admins" ||
    pathname.startsWith("/settings/admins/") ||
    pathname === "/settings/audit" ||
    pathname === "/settings/copilot" ||
    pathname === "/settings/copilot/confirm"
  )
}
