import { useState } from "react"

import { CheckCircleFillIcon, MarkGithubIcon, OrganizationIcon } from "@primer/octicons-react"
import { Button, FormControl, Heading, Text, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { ReplicaLogo } from "@components/replica-logo"

import type { IdentityOnboardingPageProps, IdentityProviderName } from "./types"
import "./styles.css"

const providerCopy: Record<
  IdentityProviderName,
  { eyebrow: string; heading: string; description: string }
> = {
  github: {
    eyebrow: "GitHub App",
    heading: "Sign in with GitHub",
    description:
      "Use GitHub user authorization, then prove access through the configured App installation.",
  },
  "oidc-demo": {
    eyebrow: "Local demo adapter",
    heading: "Sign in with OIDC",
    description:
      "Simulate an enterprise identity response locally without configuring a GitHub App.",
  },
}

export function IdentityOnboardingPage({
  configuration,
  session,
  selectedProvider,
  busy,
  error,
  onSelectProvider,
  onBack,
  onStartGitHub,
  onSubmitOidc,
  onSignOut,
}: IdentityOnboardingPageProps) {
  const [subject, setSubject] = useState("demo-user-1001")
  const [login, setLogin] = useState("mona")
  const [name, setName] = useState("Mona Lisa")

  const repositoryDescription =
    configuration.repositoryProvider === "github"
      ? session?.user.provider === "github"
        ? "Connected through the GitHub App. Repository permission checks are available."
        : "Configured separately, but this session has no linked GitHub identity. Repository features stay unavailable."
      : "No repository provider is configured. Hub onboarding still works, while GitHub-dependent features stay unavailable."

  if (session) {
    return (
      <main className="identity-onboarding">
        <header className="identity-onboarding__brand">
          <ReplicaLogo />
          <Text as="p">Identity provider decoupling demo</Text>
        </header>
        <section className="identity-onboarding__session">
          <div className="identity-onboarding__success">
            <CheckCircleFillIcon size={24} aria-hidden="true" />
            <div>
              <Text as="p" className="identity-onboarding__eyebrow">
                Hub session created
              </Text>
              <Heading as="h1" size="2">
                Welcome, {session.user.name ?? session.user.login}
              </Heading>
            </div>
          </div>
          <div className="identity-onboarding__facts">
            <div>
              <Text as="p">Hub user</Text>
              <Text as="p" weight="semibold">
                {session.user.login}
              </Text>
            </div>
            <div>
              <Text as="p">Sign-in provider</Text>
              <Text as="p" weight="semibold">
                {session.user.provider === "github" ? "GitHub App" : "OIDC demo"}
              </Text>
            </div>
            <div>
              <Text as="p">Session ID</Text>
              <Text as="p" weight="semibold">
                {session.session.id}
              </Text>
            </div>
          </div>
          <section className="identity-onboarding__capability">
            <OrganizationIcon size={20} aria-hidden="true" />
            <div>
              <Heading as="h2" size="5">
                GitHub repository integration
              </Heading>
              <Text as="p">{repositoryDescription}</Text>
            </div>
          </section>
          <Button variant="secondary" onClick={onSignOut} disabled={busy}>
            End demo session
          </Button>
        </section>
      </main>
    )
  }

  const selected = selectedProvider
    ? configuration.signInProviders.find(({ name }) => name === selectedProvider)
    : null

  return (
    <main className="identity-onboarding">
      <header className="identity-onboarding__brand">
        <ReplicaLogo />
        <Text as="p">Identity provider decoupling demo</Text>
      </header>
      <section className="identity-onboarding__panel">
        {error ? <HubAlert title={error} variant="warning" /> : null}
        {!selectedProvider ? (
          <>
            <div className="identity-onboarding__intro">
              <Text as="p" className="identity-onboarding__eyebrow">
                Choose an onboarding mode
              </Text>
              <Heading as="h1" size="2">
                Sign in to Replica Hub
              </Heading>
              <Text as="p">
                User identity and repository access are separate capabilities. Choose how this Hub
                should identify you first.
              </Text>
            </div>
            <div className="identity-onboarding__providers">
              {configuration.signInProviders.map((provider) => {
                const copy = providerCopy[provider.name]
                return (
                  <button
                    className="identity-onboarding__provider"
                    type="button"
                    key={provider.name}
                    onClick={() => onSelectProvider(provider.name)}
                  >
                    {provider.name === "github" ? (
                      <MarkGithubIcon size={24} aria-hidden="true" />
                    ) : (
                      <OrganizationIcon size={24} aria-hidden="true" />
                    )}
                    <span>
                      <span className="identity-onboarding__eyebrow">{copy.eyebrow}</span>
                      <span className="identity-onboarding__provider-heading">{copy.heading}</span>
                      <span>{copy.description}</span>
                      {!provider.configured ? (
                        <span className="identity-onboarding__provider-warning">
                          Operator configuration required
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <button className="identity-onboarding__back" type="button" onClick={onBack}>
              ← Choose another provider
            </button>
            <div className="identity-onboarding__intro">
              <Text as="p" className="identity-onboarding__eyebrow">
                Review provider settings
              </Text>
              <Heading as="h1" size="2">
                {providerCopy[selectedProvider].heading}
              </Heading>
              <Text as="p">{providerCopy[selectedProvider].description}</Text>
            </div>
            <dl className="identity-onboarding__settings">
              <div>
                <dt>Sign-in adapter</dt>
                <dd>{selectedProvider === "github" ? "github" : "oidc-demo"}</dd>
              </div>
              <div>
                <dt>Repository provider</dt>
                <dd>{configuration.repositoryProvider}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{configuration.demoMode ? "Explicit local demo" : "Configured deployment"}</dd>
              </div>
            </dl>
            {selectedProvider === "github" ? (
              <>
                {!selected?.configured ? (
                  <HubAlert
                    title="Configure GitHub App credentials before starting this flow."
                    variant="warning"
                  />
                ) : null}
                <Button
                  variant="primary"
                  onClick={onStartGitHub}
                  disabled={busy || !selected?.configured}
                >
                  Continue to GitHub
                </Button>
              </>
            ) : (
              <form
                className="identity-onboarding__form"
                onSubmit={(event) => {
                  event.preventDefault()
                  onSubmitOidc({ subject, login, name: name || null })
                }}
              >
                <HubAlert
                  title="Demo only: this form simulates claims from a trusted OIDC issuer."
                  variant="warning"
                />
                <FormControl id="oidc-demo-subject" required fullWidth>
                  <FormControl.Label>OIDC subject</FormControl.Label>
                  <TextInput
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    required
                    fullWidth
                  />
                </FormControl>
                <FormControl id="oidc-demo-login" required fullWidth>
                  <FormControl.Label>Display login</FormControl.Label>
                  <TextInput
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    required
                    fullWidth
                  />
                </FormControl>
                <FormControl id="oidc-demo-name" fullWidth>
                  <FormControl.Label>Name</FormControl.Label>
                  <TextInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    fullWidth
                  />
                </FormControl>
                <Button type="submit" variant="primary" disabled={busy}>
                  Create simulated OIDC session
                </Button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  )
}
