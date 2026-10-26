export type IdentityProviderName = "github" | "oidc-demo"

export interface IdentityConfiguration {
  demoMode: boolean
  credentialProvider: "database" | "environment" | "none"
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
  showSetup: boolean
  selectedProvider: IdentityProviderName | null
  busy: boolean
  error: string | null
  onContinueFromSetup: () => void
  onSelectProvider: (provider: IdentityProviderName) => void
  onBack: () => void
  onStartGitHub: () => void
  onSubmitGitHubDemo: (profile: { subject: string; login: string; name: string | null }) => void
  onSubmitOidc: (profile: { subject: string; login: string; name: string | null }) => void
  onSignOut: () => void
}
