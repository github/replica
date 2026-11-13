import { CheckCircleFillIcon, QuestionIcon, XCircleFillIcon } from "@primer/octicons-react"
import { Button, Heading, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"

import type { GithubConnectionCheckResult, GithubSettingStatus } from "./types"

import "./styles.css"

type Props = {
  settings: GithubSettingStatus[]
  configured: boolean
  signInEnabled: boolean
  signInPath: string
  checks: GithubConnectionCheckResult[] | null
  testing: boolean
  testError: string | null
  onTest: () => void
}

const settingLabels: Record<GithubSettingStatus["state"], string> = {
  present: "Set",
  missing: "Missing",
  invalid: "Invalid",
}

const checkLabels: Record<string, string> = {
  private_key: "Private key",
  app_identity: "App identity",
  installation: "Installation",
  callback_url: "Callback URL",
  repositories: "Repositories",
}

/** Reports which settings the server sees and verifies them against GitHub. */
export function GithubAppConnectionStatus({
  settings,
  configured,
  signInEnabled,
  signInPath,
  checks,
  testing,
  testError,
  onTest,
}: Props) {
  const passed = checks !== null && checks.every((check) => check.result === "pass")
  return (
    <section className="setup-section" aria-labelledby="github-app-status-heading">
      <Heading as="h2" size="5" id="github-app-status-heading">
        3. Check the connection
      </Heading>
      <Text as="p" size="100">
        These are the values this server read at startup. Secret values are never shown.
      </Text>
      <ul className="github-app-settings" aria-label="GitHub App settings">
        {settings.map((setting) => (
          <li key={setting.key}>
            <code>{setting.key}</code>
            <span
              className={`github-app-settings__state github-app-settings__state--${setting.state}`}
            >
              {settingLabels[setting.state]}
            </span>
          </li>
        ))}
      </ul>

      {configured ? (
        <div className="setup__form">
          <Button type="button" variant="secondary" onClick={onTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testError ? (
            <HubAlert
              variant="critical"
              title={
                checks
                  ? "Could not refresh connected repositories"
                  : "The connection test did not run"
              }
              description={testError}
            />
          ) : null}
          {checks ? (
            <ul className="github-app-checks" aria-label="Connection test results">
              {checks.map((check) => (
                <li key={check.name} className={`github-app-checks__item--${check.result}`}>
                  {check.result === "pass" ? (
                    <CheckCircleFillIcon aria-label="Passed" />
                  ) : check.result === "fail" ? (
                    <XCircleFillIcon aria-label="Failed" />
                  ) : (
                    <QuestionIcon aria-label="Not verified" />
                  )}
                  <div>
                    <strong>{checkLabels[check.name] ?? check.name}</strong>
                    <Text as="p" size="100">
                      {check.detail}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <HubAlert
          variant="info"
          title="Add the missing settings"
          description="Store the missing values, restart or redeploy the server, then reload this page."
        />
      )}

      {signInEnabled ? (
        <HubAlert
          variant={passed ? "success" : "info"}
          title="GitHub sign-in is enabled"
          action={
            <Button as="a" href={signInPath} variant="primary" size="small">
              Sign in with GitHub
            </Button>
          }
        />
      ) : null}
    </section>
  )
}
