import type { GithubAppForm, GithubAppPageData } from "@pages/github-app-page/types"

import type { WorkspaceResponse } from "../../contracts/types"
import type { SettingsQuery, SettingsWorkspaceResponse } from "../../settings-contracts/types"
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
      confirmLabel: "I confirm this GitHub App change.",
    }
    if (change === "credentials") {
      heading = "Replace App credentials"
      form = {
        ...common,
        method: "patch",
        submitLabel: "Save replacement credentials",
        confirmLabel: "I confirm these replacements belong to the same GitHub App.",
        credentials: {
          secretLabel: "New client secret",
          keyLabel: "New private key file (.pem)",
          limits:
            "At most 4 KiB for the secret and 16 KiB for the PEM. Saved secrets are never displayed.",
        },
      }
    } else if (change === "reset") {
      heading = "Reset local GitHub App?"
      form = {
        ...common,
        method: "delete",
        submitLabel: "Delete local App configuration",
        confirmLabel: "I have the bootstrap secret and understand the sign-out and revocation.",
        confirmationPhraseLabel: 'Type "delete local GitHub App configuration"',
        confirmationPhrase: "delete local GitHub App configuration",
      }
    } else {
      heading = "Webhook secret rotation"
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
            ? "Start webhook rotation"
            : state.github.rotation === "pending"
              ? "Retry saved webhook update"
              : "Stop accepting the old secret",
        confirmLabel:
          state.github.rotation === "idle"
            ? "I confirm that Hub should generate and install a replacement webhook secret while accepting the previous secret."
            : state.github.rotation === "pending"
              ? "I confirm that both secrets will remain accepted."
              : "Delayed deliveries signed with the old secret will be rejected.",
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
      change === "credentials"
        ? "A candidate key verifies App identity, not client-secret correctness."
        : change === "rotation"
          ? "Hub generates the secret and updates GitHub directly. No secret is displayed or copied through this page."
          : change === "reset"
            ? "Sign everyone out. The remote App is not changed."
            : "Administer this Hub's App without changing repository permissions.",
    ),
    pageTitle: heading,
    configurationId: state.github.state === "not-configured" ? null : 1,
    version: state.github.version,
    identity: null,
    installation: installed ? "Installation active" : null,
    busyLabel: null,
    verification:
      "GitHub must have verified this browser's account within the last five minutes. If verification is required, Hub temporarily encrypts your submitted settings and continues your confirmed change after it succeeds.",
    paragraphs:
      change === "reset"
        ? [
            "Users, administrator roles, Builds, files, reviews and audit history remain.",
            "Retained public links may resume under existing policy after reinstall.",
          ]
        : !installed
          ? [
              state.github.state === "not-configured"
                ? "No GitHub App is configured. Setup requires the deployment bootstrap secret."
                : `Install this App in the ${state.github.organization} account and select its repositories. Hub checks GitHub automatically and restores access after installation.`,
            ]
          : [
              state.github.rotation === "pending"
                ? "GitHub has not confirmed the update. Retry sends the same saved replacement."
                : state.github.rotation === "confirmed"
                  ? "GitHub confirmed the replacement. Both secrets remain accepted."
                  : "Only the current webhook secret is accepted.",
            ],
    links: !allowed
      ? []
      : installed
        ? [
            { label: "App overview", path: resourcePath("/settings/github", search) },
            {
              label: "Replace App credentials",
              path: resourcePath("/settings/github", search, { change: "credentials" }),
            },
            {
              label: "Webhook secret rotation",
              path: resourcePath("/settings/github", search, { change: "rotation" }),
            },
            {
              label: "Reset local GitHub App?",
              path: resourcePath("/settings/github", search, { change: "reset" }),
            },
          ]
        : [
            {
              label: "Continue GitHub App setup",
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
