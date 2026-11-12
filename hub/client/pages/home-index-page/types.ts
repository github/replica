export interface HomeSignInAction {
  label: string
  path: string
  provider: "github" | "entra" | "local"
}

export interface HomeIndexPageData {
  alert: string | null
  authenticityToken: string
  badge: string
  badgeAlternate: string
  description: string
  footerNote: string
  heading: string
  notice: string | null
  pageTitle: string
  pauseAnimationLabel: string
  resumeAnimationLabel: string
  signInActions: HomeSignInAction[]
}
