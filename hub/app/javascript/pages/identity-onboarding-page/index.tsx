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
  showSetup,
  selectedProvider,
  busy,
  error,
  onContinueFromSetup,
  onSelectProvider,
  onBack,
  onStartGitHub,
  onSubmitGitHubDemo,
  onSubmitOidc,
  onSignOut,
}: IdentityOnboardingPageProps) {
  const [subject, setSubject] = useState("demo-user-1001")
  const [login, setLogin] = useState("mona")
  const [name, setName] = useState("Mona Lisa")
  const [githubSubject, setGitHubSubject] = useState("583231")
  const [githubLogin, setGitHubLogin] = useState("octocat")
  const [githubName, setGitHubName] = useState("The Octocat")

  const repositoryDescription =
    configuration.repositoryProvider === "github"
      ? session?.user.provider === "github"
        ? "Connected through the GitHub App. Repository permission checks are available."
        : "Configured separately, but this session has no linked GitHub identity. Repository features stay unavailable."
      : "No repository provider is configured. Hub onboarding still works, while GitHub-dependent features stay unavailable."

  if (showSetup) {
    const signInProviders = configuration.signInProviders.map(({ name: provider }) => provider)
    return (
      <main className="identity-onboarding">
        <header className="identity-onboarding__brand">
          <ReplicaLogo />
          <Text as="p">Identity provider decoupling demo</Text>
        </header>
        <section className="identity-onboarding__panel">
          <div className="identity-onboarding__intro">
            <Text as="p" className="identity-onboarding__eyebrow">
              Local operator setup
            </Text>
            <Heading as="h1" size="2">
              Configure Replica after cloning
            </Heading>
            <Text as="p">
              This walkthrough uses the same explicit settings the API reads at startup. No provider
              is selected as a fallback.
            </Text>
          </div>
          <ol className="identity-onboarding__setup-steps">
            <li>
              <Heading as="h2" size="5">
                Install the Hub
              </Heading>
              <pre>
                <code>{`git clone https://github.com/github/replica.git
cd replica/hub
npm ci`}</code>
              </pre>
            </li>
            <li>
              <Heading as="h2" size="5">
                Choose identity and repository providers
              </Heading>
              <pre>
                <code>{`HUB_DEMO_MODE=true
HUB_SIGN_IN_PROVIDERS=${signInProviders.join(",")}
HUB_REPOSITORY_PROVIDER=${configuration.repositoryProvider}
HUB_CREDENTIAL_PROVIDER=${configuration.credentialProvider}`}</code>
              </pre>
              <Text as="p">
                {configuration.credentialProvider === "none"
                  ? "This OIDC-only setup needs no GitHub credentials."
                  : "GitHub App and installation credentials stay in the selected credential provider."}
              </Text>
            </li>
            <li>
              <Heading as="h2" size="5">
                Start the local Hub
              </Heading>
              <pre>
                <code>{`npm run db:deploy
npm run dev:api
npm run dev`}</code>
              </pre>
            </li>
          </ol>
          <section className="identity-onboarding__capability">
            <OrganizationIcon size={20} aria-hidden="true" />
            <div>
              <Heading as="h2" size="5">
                Repository impact
              </Heading>
              <Text as="p">
                {configuration.repositoryProvider === "github"
                  ? "GitHub repository capabilities are enabled, but each Hub session still needs a GitHub identity."
                  : "GitHub repository capabilities are disabled. Users can still enter Hub through OIDC."}
              </Text>
            </div>
          </section>
          <Button variant="primary" onClick={onContinueFromSetup}>
            Continue to user sign-in
          </Button>
        </section>
      </main>
    )
  }

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
              {session.user.provider === "github" &&
              configuration.repositoryProvider === "github" ? (
                <div className="identity-onboarding__repository-result">
                  <span>github/replica</span>
                  <strong>read</strong>
                  <span>
                    Requests use the configured App installation for current permission checks
                  </span>
                </div>
              ) : null}
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
                {configuration.demoMode ? (
                  <form
                    className="identity-onboarding__form identity-onboarding__demo-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      onSubmitGitHubDemo({
                        subject: githubSubject,
                        login: githubLogin,
                        name: githubName || null,
                      })
                    }}
                  >
                    <HubAlert
                      title="Recording helper: simulate the completed GitHub callback locally."
                      variant="warning"
                    />
                    <FormControl id="github-demo-subject" required fullWidth>
                      <FormControl.Label>GitHub user ID</FormControl.Label>
                      <TextInput
                        value={githubSubject}
                        onChange={(event) => setGitHubSubject(event.target.value)}
                        required
                        fullWidth
                      />
                    </FormControl>
                    <FormControl id="github-demo-login" required fullWidth>
                      <FormControl.Label>GitHub login</FormControl.Label>
                      <TextInput
                        value={githubLogin}
                        onChange={(event) => setGitHubLogin(event.target.value)}
                        required
                        fullWidth
                      />
                    </FormControl>
                    <FormControl id="github-demo-name" fullWidth>
                      <FormControl.Label>Name</FormControl.Label>
                      <TextInput
                        value={githubName}
                        onChange={(event) => setGitHubName(event.target.value)}
                        fullWidth
                      />
                    </FormControl>
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Simulate completed GitHub authorization
                    </Button>
                  </form>
                ) : null}
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
