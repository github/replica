export function authenticationCookies(secure: boolean) {
  const prefix = secure ? "__Host-" : ""
  return {
    session: `${prefix}replica-session`,
    authorization: `${prefix}replica-authorization`,
    csrf: `${prefix}replica-csrf`,
    privateOptions: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    } as const,
    csrfOptions: {
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
    } as const,
  }
}
