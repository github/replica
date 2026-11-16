import { Heading } from "@primer/react-brand"

import { CopyableTextInput } from "@components/copyable-text-input"
import { githubAppRequirements } from "@utils/github-app-requirements"

import type { GithubAppSetupUrls } from "./types"

import "./styles.css"

export function GithubAppFields({ urls }: { urls: GithubAppSetupUrls }) {
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
