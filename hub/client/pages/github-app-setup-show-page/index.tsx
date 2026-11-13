import { useState } from "react"
import { Button, Heading, Text } from "@primer/react-brand"

import { GithubAppBootstrapForm } from "@features/github-app-bootstrap-form"
import { GithubAppConnectionStatus } from "@features/github-app-connection-status"
import { GithubAppRegistrationGuide } from "@features/github-app-registration-guide"
import type { GithubAppRegistrationPath } from "@features/github-app-registration-guide/types"
import { GithubAppSecretGuide } from "@features/github-app-secret-guide"
import type { GithubAppSecretTarget } from "@features/github-app-secret-guide/types"
import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"

import type { GithubAppSetupShowPageProps } from "./types"

const header = {
  productName: "Replica Hub",
  heading: "Connect GitHub",
}

/** Guides an operator through registering, storing, and verifying the Hub's GitHub App. */
export function GithubAppSetupShowPage({
  status,
  bootstrap,
  organization,
  onOrganizationChange,
  creationUrl,
  connection,
  signInPath,
}: GithubAppSetupShowPageProps) {
  const [path, setPath] = useState<GithubAppRegistrationPath>(
    status?.status === "not_configured" ? "prefilled" : "reuse",
  )
  const [target, setTarget] = useState<GithubAppSecretTarget>("key-vault")
  const installationUrl = connection.checks?.find(
    (check) => check.name === "installation" && check.result === "pass",
  )?.settingsUrl

  if (!status) {
    return (
      <GithubAppSetupPage>
        <GithubAppSetupHeader
          data={{
            ...header,
            description: "Enter this Hub's bootstrap secret to view its GitHub App setup.",
          }}
        />
        <GithubAppBootstrapForm {...bootstrap} />
      </GithubAppSetupPage>
    )
  }

  return (
    <GithubAppSetupPage width="wide">
      <GithubAppSetupHeader
        data={{
          ...header,
          description:
            status.status === "configured"
              ? "This Hub has a GitHub App. Verify it, rotate its secrets, or update its settings."
              : "Connect a private GitHub App so users can sign in and Hub can read prototype repositories.",
        }}
      />
      <GithubAppRegistrationGuide
        path={path}
        onPathChange={setPath}
        organization={organization}
        onOrganizationChange={onOrganizationChange}
        creationUrl={creationUrl}
        urls={status.urls}
      />
      <GithubAppSecretGuide target={target} onTargetChange={setTarget} />
      <GithubAppConnectionStatus
        settings={status.settings}
        configured={status.status === "configured"}
        signInEnabled={status.signInEnabled}
        signInPath={signInPath}
        checks={connection.checks}
        testing={connection.testing}
        testError={connection.error}
        onTest={connection.onTest}
      />
      {status.status === "configured" ? (
        <section className="setup-section" aria-labelledby="github-connected-repositories">
          <Heading as="h2" size="5" id="github-connected-repositories">
            Connected repositories
          </Heading>
          <Text as="p" size="100">
            These repositories were last synchronized from the GitHub App installation. Removed
            repositories are hidden; their prototypes and Builds are kept.
          </Text>
          {status.connectedRepositories.length ? (
            <ul aria-label="Connected repositories">
              {status.connectedRepositories.map((repository) => (
                <li key={repository}>{repository}</li>
              ))}
            </ul>
          ) : (
            <Text as="p" size="100">
              No repositories are connected. Run Test connection to synchronize the installation.
            </Text>
          )}
          {installationUrl ? (
            <Button
              as="a"
              href={installationUrl}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
            >
              Manage repositories on GitHub
            </Button>
          ) : (
            <Text as="p" size="100">
              Run Test connection to open the installation settings. If GitHub cannot provide a
              link, open the installed App in your account or organization settings.
            </Text>
          )}
        </section>
      ) : null}
    </GithubAppSetupPage>
  )
}
