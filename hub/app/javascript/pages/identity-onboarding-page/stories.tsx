import type { Meta, StoryObj } from "@storybook/react-vite"

import { IdentityOnboardingPage } from "."

const configuration = {
  demoMode: true,
  credentialProvider: "environment" as const,
  signInProviders: [
    { name: "github" as const, configured: true },
    { name: "oidc-demo" as const, configured: true },
  ],
  repositoryProvider: "github" as const,
}

const meta = {
  title: "Hub/Pages/Identity onboarding",
  component: IdentityOnboardingPage,
  parameters: { layout: "fullscreen" },
  args: {
    configuration,
    session: null,
    showSetup: false,
    selectedProvider: null,
    busy: false,
    error: null,
    onContinueFromSetup: () => {},
    onSelectProvider: () => {},
    onBack: () => {},
    onStartGitHub: () => {},
    onSubmitGitHubDemo: () => {},
    onSubmitOidc: () => {},
    onSignOut: () => {},
  },
} satisfies Meta<typeof IdentityOnboardingPage>

export default meta
type Story = StoryObj<typeof meta>

export const ProviderChoice: Story = {}

export const GitHubSetup: Story = {
  args: { showSetup: true },
}

export const OidcSetupWithoutRepositories: Story = {
  args: {
    showSetup: true,
    configuration: {
      demoMode: true,
      credentialProvider: "none",
      signInProviders: [{ name: "oidc-demo", configured: true }],
      repositoryProvider: "none",
    },
  },
}

export const GitHubReview: Story = {
  args: { selectedProvider: "github" },
}

export const OidcDemoReview: Story = {
  args: { selectedProvider: "oidc-demo" },
}

export const OidcSessionWithoutRepositoryIdentity: Story = {
  args: {
    session: {
      user: {
        id: "785ff3b4-7a8a-4bf8-80cb-c67cb5ce7f1e",
        provider: "oidc-demo",
        providerId: "demo-user-1001",
        login: "mona",
        name: "Mona Lisa",
        avatarUrl: null,
        administrator: false,
      },
      session: {
        id: "af71b681-341b-4b79-a8e3-d16d881fc3a2",
        signedInAt: "2026-10-26T20:00:00.000Z",
      },
      csrfToken: "storybook-csrf",
    },
  },
}

export const GitHubSessionWithRepositoryAccess: Story = {
  args: {
    session: {
      user: {
        id: "785ff3b4-7a8a-4bf8-80cb-c67cb5ce7f1e",
        provider: "github",
        providerId: "583231",
        login: "octocat",
        name: "The Octocat",
        avatarUrl: null,
        administrator: false,
      },
      session: {
        id: "af71b681-341b-4b79-a8e3-d16d881fc3a2",
        signedInAt: "2026-10-26T20:00:00.000Z",
      },
      csrfToken: "storybook-csrf",
    },
  },
}

export const OidcSessionWithoutRepositoryProvider: Story = {
  args: {
    configuration: { ...configuration, repositoryProvider: "none" },
    session: OidcSessionWithoutRepositoryIdentity.args?.session,
  },
}
