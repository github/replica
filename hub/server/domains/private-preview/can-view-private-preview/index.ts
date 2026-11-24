export function canViewPrivatePreview(
  viewer: { sessionProvider: string | null; role: string },
  localSignInConfigured: boolean,
) {
  return (
    viewer.sessionProvider === "github" ||
    (localSignInConfigured && viewer.sessionProvider === "local" && viewer.role === "ADMINISTRATOR")
  )
}
