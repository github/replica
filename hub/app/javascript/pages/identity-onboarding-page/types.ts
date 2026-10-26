export type IdentityProviderName = "github" | "oidc-demo"

export interface IdentityConfiguration {
  demoMode: boolean
  signInProviders: Array<{
    name: IdentityProviderName
    configured: boolean
  }>
  repositoryProvider: "github" | "none"
}

export interface IdentitySession {
  user: {
    id: string
    provider: string
    providerId: string
    login: string
    name: string | null
    avatarUrl: string | null
    administrator: boolean
  }
  session: {
    id: string
    signedInAt: string
  }
  csrfToken: string
}

export interface IdentityOnboardingPageProps {
  configuration: IdentityConfiguration
  session: IdentitySession | null
  selectedProvider: IdentityProviderName | null
  busy: boolean
  error: string | null
  onSelectProvider: (provider: IdentityProviderName) => void
  onBack: () => void
  onStartGitHub: () => void
  onSubmitOidc: (profile: { subject: string; login: string; name: string | null }) => void
  onSignOut: () => void
}
