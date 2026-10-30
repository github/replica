import type { GithubAppForm, GithubAppPageData } from "@pages/github-app-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsQuery, SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"
import { settingsAdministration } from "../settings-administration"

export function settingsGithub(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  query: SettingsQuery,
): GithubAppPageData {
  const allowed = state.session.capabilities.administerHub
  const installed = state.github.state === "installed"
  const change = query.change
  let form: GithubAppForm | null = null
  let heading = "GitHub App"
  if (allowed && installed && change) {
    const common = {
      action: resourcePath("/settings/github", search, { change }),
      disabled: false,
      simulation: true,
      confirmLabel: "I confirm this change affects synthetic local records only.",
    }
    if (change === "credentials") {
      heading = "Simulate replacement credentials"
      form = {
        ...common,
        method: "patch",
        submitLabel: "Advance fake credential revision",
        credentials: {
          secretLabel: "Not collected",
          keyLabel: "Not collected",
          limits:
            "No secret field or file upload is available. This advances a fake nonsecret revision number.",
        },
      }
    } else if (change === "reset") {
      heading = "Reset mock App configuration"
      form = {
        ...common,
        method: "delete",
        submitLabel: "Reset mock configuration",
        confirmationPhraseLabel: "Type delete mock GitHub App configuration",
        confirmationPhrase: "delete mock GitHub App configuration",
      }
    } else {
      heading = "Simulate webhook rotation"
      form = {
        ...common,
        method: state.github.rotation === "confirmed" ? "delete" : "post",
        operation:
          state.github.rotation === "idle"
            ? "start"
            : state.github.rotation === "pending"
              ? "retry"
              : undefined,
        submitLabel:
          state.github.rotation === "idle"
            ? "Start simulated rotation"
            : state.github.rotation === "pending"
              ? "Confirm fake provider response"
              : "Finish simulated rotation",
      }
    }
  }
  return {
    ...settingsAdministration(
      workspace,
      state,
      search,
      "github",
      heading,
      "GitHub App setup and changes are local simulations. No provider, repository access or credentials are involved.",
    ),
    pageTitle: heading,
    configurationId: state.github.state === "not-configured" ? null : 1,
    version: state.github.version,
    identity: installed ? "Synthetic App mock-app-1 — github" : null,
    installation: installed ? "Fake installation mock-installation-1" : null,
    busyLabel:
      change === "rotation" && state.github.rotation === "pending"
        ? "The fake provider response is pending. Confirm it below to advance the fixture."
        : null,
    verification:
      "This confirmation changes only the in-memory fixture. No authorization or secret rotation occurs.",
    paragraphs: [
      installed
        ? `Mock credential revision ${state.github.credentialRevision}; mock webhook rotation ${state.github.rotation}.`
        : `Mock setup state: ${state.github.state}. Complete the local setup example to try App changes.`,
    ],
    links: !allowed
      ? []
      : installed
        ? [
            { label: "App overview", path: resourcePath("/settings/github", search) },
            {
              label: "Fake credential replacement",
              path: resourcePath("/settings/github", search, { change: "credentials" }),
            },
            {
              label: "Simulated webhook rotation",
              path: resourcePath("/settings/github", search, { change: "rotation" }),
            },
            {
              label: "Reset mock configuration",
              path: resourcePath("/settings/github", search, { change: "reset" }),
            },
          ]
        : [
            {
              label: "Continue mock App setup",
              path: resourcePath(
                state.github.state === "registered"
                  ? "/settings/github/installed"
                  : state.github.state === "ready"
                    ? "/settings/github/register"
                    : "/settings/github/setup",
                search,
              ),
            },
          ],
    form,
  }
}
