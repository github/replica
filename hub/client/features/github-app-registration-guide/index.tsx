import { LinkExternalIcon } from "@primer/octicons-react"
import { Button, FormControl, Heading, Text, TextInput } from "@primer/react-brand"

import { CopyableTextInput } from "@components/copyable-text-input"
import { HubSegmentedControl } from "@components/hub-segmented-control"
import { githubAppRequirements } from "@utils/github-app-requirements"

import type { GithubAppRegistrationPath, GithubAppSetupUrls } from "./types"

import "./styles.css"

type Props = {
  path: GithubAppRegistrationPath
  onPathChange: (path: GithubAppRegistrationPath) => void
  organization: string
  onOrganizationChange: (organization: string) => void
  creationUrl: string
  urls: GithubAppSetupUrls
}

const pathOptions = [
  { label: "Create from a prefilled form", value: "prefilled" },
  { label: "Create manually", value: "manual" },
  { label: "Reuse an existing App", value: "reuse" },
] as const

/** Explains how to register a GitHub App or update an existing one for this Hub. */
export function GithubAppRegistrationGuide({
  path,
  onPathChange,
  organization,
  onOrganizationChange,
  creationUrl,
  urls,
}: Props) {
  return (
    <section className="setup-section" aria-labelledby="github-app-registration-heading">
      <Heading as="h2" size="6" id="github-app-registration-heading">
        1. Register the GitHub App
      </Heading>
      <HubSegmentedControl
        aria-label="GitHub App registration path"
        options={pathOptions}
        value={path}
        onChange={onPathChange}
        fullWidth
        size="small"
      />

      {path === "prefilled" ? (
        <div className="setup__form">
          <FormControl>
            <FormControl.Label>Organization</FormControl.Label>
            <TextInput
              autoComplete="organization"
              value={organization}
              onChange={(event) => onOrganizationChange(event.target.value)}
              fullWidth
            />
            <FormControl.Hint>
              Leave blank to create the App for your personal account.
            </FormControl.Hint>
          </FormControl>
          <Button
            as="a"
            href={creationUrl}
            target="_blank"
            rel="noreferrer"
            variant="primary"
            trailingVisual={<LinkExternalIcon />}
          >
            Open GitHub
          </Button>
          <Text as="p" size="100">
            GitHub opens a form with these URLs, permissions, and events filled in. After you create
            the App, generate a client secret and a private key. The webhook secret cannot be
            prefilled; generate and enter it in GitHub as described in step 2.
          </Text>
        </div>
      ) : null}

      {path === "reuse" ? (
        <>
          <Text as="p" size="100">
            Open the existing App&apos;s settings on GitHub. Add the callback URL below without
            removing other callback URLs, set the setup and webhook URLs, and confirm the
            permissions and events. Reuse its App ID and client ID, and generate a new client secret
            and private key for this Hub so each deployment can be rotated independently.
          </Text>
          <Text as="p" size="100">
            An App sends webhooks to one URL. Changing it moves webhook delivery from the old Hub to
            this one. An organization owner must approve any new permissions for its installation.
          </Text>
        </>
      ) : null}

      {path === "manual" ? (
        <>
          <Text as="p" size="100">
            In your GitHub account or organization settings, open Developer settings, GitHub Apps,
            then New GitHub App. Name it Replica Hub or another unique name, add the description
            “Build and review prototype branches.”, and use the values below.
          </Text>
          <ul>
            <li>Enable expiring user authorization tokens; leave device flow off.</li>
            <li>
              Turn off “Request user authorization during installation” and “Redirect on update”.
            </li>
            <li>
              Make the App private. Enable webhooks for a publicly reachable Hub; leave them off for
              localhost.
            </li>
            <li>Generate a webhook secret as shown in step 2 and enter it in GitHub.</li>
          </ul>
        </>
      ) : null}

      {path !== "prefilled" ? <GithubAppFields urls={urls} /> : null}
      <Text as="p" size="100">
        Install the App on your account or organization. Choose all repositories or only the ones
        this Hub should connect, then copy the installation ID from the installation URL. You can
        change the selection later in GitHub.
      </Text>
    </section>
  )
}

function GithubAppFields({ urls }: { urls: GithubAppSetupUrls }) {
  const copyProps = {
    compact: true,
    copyLabel: "Copy",
    copiedLabel: "Copied",
    copyErrorLabel: "Copy failed. Select the text and copy it manually.",
  }
  return (
    <div className="github-app-fields">
      <CopyableTextInput {...copyProps} label="Homepage URL" value={urls.homepage} />
      <CopyableTextInput {...copyProps} label="Callback URL" value={urls.callback} />
      <CopyableTextInput {...copyProps} label="Setup URL" value={urls.setup} />
      <CopyableTextInput {...copyProps} label="Webhook URL" value={urls.webhook} />
      <div className="github-app-fields__lists">
        <div>
          <Heading as="h3" size="6">
            Repository permissions
          </Heading>
          <ul>
            {githubAppRequirements.permissions.map((permission) => (
              <li key={permission.key}>
                {permission.label}: {permission.access === "write" ? "Read and write" : "Read-only"}
              </li>
            ))}
            <li>Metadata: Read-only (added automatically by GitHub)</li>
          </ul>
          <Heading as="h3" size="6">
            Organization permissions
          </Heading>
          <ul>
            {githubAppRequirements.organizationPermissions.map((permission) => (
              <li key={permission.key}>{permission.label}: Read-only</li>
            ))}
          </ul>
        </div>
        <div>
          <Heading as="h3" size="6">
            Webhook events
          </Heading>
          <ul>
            {githubAppRequirements.events.map((event) => (
              <li key={event.key}>{event.label}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
