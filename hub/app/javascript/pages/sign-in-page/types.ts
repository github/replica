export interface SignInPageUser {
  displayName: string | null
  username: string | null
  avatarUrl: string | null
}

export interface SignInPageProps {
  configured: boolean
  loading: boolean
  user: SignInPageUser | null
  error: string | null
  onSignIn: () => void
  onSignOut: () => void
  onBootstrap: (secret: string) => void
  onRecovery: (secret: string) => void
}
