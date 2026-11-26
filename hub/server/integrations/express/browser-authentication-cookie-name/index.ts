export function browserAuthenticationCookieName(secure: boolean): string {
  return secure ? "__Host-hub_auth_browser" : "hub_auth_browser"
}
