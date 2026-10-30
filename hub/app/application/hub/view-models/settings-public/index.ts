import type { FreshAuthorizationPageData } from "@pages/fresh-authorization-page/types"
import type { GithubAppSetupInstallPageData } from "@pages/github-app-setup-install-page/types"
import type { GithubAppSetupRegisterPageData } from "@pages/github-app-setup-register-page/types"
import type { GithubAppSetupShowPageData } from "@pages/github-app-setup-show-page/types"
import type { HubAdminEnrollmentPageData } from "@pages/hub-admin-enrollment-page/types"
import type { SessionRevocationPageData } from "@pages/session-revocation-page/types"

import type { SettingsPublicResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"

export function settingsPublic(state: SettingsPublicResponse, search: URLSearchParams) {
  const shared = { productName: "Replica Hub", authenticityToken: "" }
  const allowed = state.session.capabilities.administerHub
  const signedOut = !state.session.viewer
  const needAdmin = allowed
    ? ""
    : " Select the Admin mock profile to try this local change. No real sign-in is involved."
  const setup: GithubAppSetupShowPageData = {
    ...shared,
    simulation: true,
    canContinue: allowed && ["not-configured", "ready"].includes(state.github.state),
    pageTitle: "Mock App setup",
    heading: "Simulate GitHub App setup",
    description: `This flow creates a synthetic App record only. No bootstrap secret, account or provider connection is used.${needAdmin}`,
    organizationLabel: "Synthetic organization",
    organizationHint: "github is a fixed fixture identifier, not a connected organization.",
    secretLabel: "Not collected",
    submitLabel: "Continue mock setup",
    submitPath: resourcePath("/settings/github/setup", search),
  }
  const register: GithubAppSetupRegisterPageData = {
    ...shared,
    simulation: true,
    canContinue: allowed,
    pageTitle: "Register mock App",
    heading: "Register the mock App",
    description: `No App is created on GitHub. This advances one local fixture record.${needAdmin}`,
    access:
      "The fixture refers to github/prototype and github/empty. No repository access is requested or granted.",
    manifest: '{"name":"Replica Hub mock","mock":true}',
    submitLabel: "Register simulation",
    submitPath: resourcePath("/settings/github/register", search),
  }
  const installed = state.github.state === "installed"
  const install: GithubAppSetupInstallPageData = {
    ...shared,
    simulation: true,
    pageTitle: installed ? "Mock App installed" : "Mock App installation",
    heading: installed ? "Mock installation complete" : "Simulate App installation",
    description: `The App and installation identifiers are synthetic. No external App or repository changed.${needAdmin}`,
    canContinue: allowed,
    submitPath: installed ? undefined : resourcePath("/settings/github/installed", search),
    submitLabel: installed ? undefined : "Simulate installation",
    nextPath: resourcePath("/settings/github", search),
    nextLabel: "Review mock App",
  }
  const enrollment: HubAdminEnrollmentPageData = {
    ...shared,
    simulation: true,
    canContinue: allowed,
    pageTitle: "Mock administrator enrollment",
    heading: "Try administrator enrollment",
    description: `Continue as the synthetic Octocat user, then confirm a local continuation. No secret or provider identity is requested.${needAdmin}`,
    secretLabel: "Not collected",
    submitLabel: "Start mock enrollment example",
    submitPath: resourcePath("/settings/enroll", search),
  }
  const authorization: FreshAuthorizationPageData = {
    ...shared,
    simulation: true,
    canContinue: !!state.continuation && allowed,
    pageTitle: "Mock confirmation",
    heading: state.continuation ? "Confirm the simulated continuation" : "Nothing to confirm",
    description: state.continuation
      ? `Confirm ${state.continuation.operation} for @${state.continuation.viewerLogin}. This is not a GitHub, password or MFA check.`
      : "No pending mock continuation belongs to this profile. Start a Copilot or enrollment simulation first.",
    submitLabel: "Confirm simulation",
    submitPath: resourcePath("/settings/authorize", search),
    cancelLabel: "Cancel simulation",
    cancelPath: state.continuation ? resourcePath("/settings/authorize", search) : undefined,
    continuation: state.continuation ? { id: state.continuation.id, method: "post" } : undefined,
  }
  const sessions: SessionRevocationPageData = {
    simulation: true,
    heading: signedOut
      ? state.sessionRevoked
        ? "Mock browser session ended"
        : "Mock browser is signed out"
      : "End this mock browser session?",
    description:
      "This simulation affects only this tab's in-memory profile. Real sessions, other browsers and share links are untouched.",
    pageTitle: "Mock browser session",
    auditLabel: "Security audit",
    auditPath: allowed ? resourcePath("/settings/audit", search) : null,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/",
    signOutLabel: "Sign out of mock session",
    signOutPath: "/session",
    authenticityToken: "",
    signedOut,
    notice:
      signedOut && state.sessionRevoked
        ? "The mock session ended. Use the mock profile controls to start again."
        : null,
    alert:
      !signedOut && !allowed
        ? "This mock profile cannot run the administrator session-ending example."
        : null,
    canRevoke: allowed,
    scope:
      "The current synthetic browser profile signs out. No credentials or external connections exist.",
    ownSession: allowed
      ? `@${state.session.viewer?.login ?? "octocat"} will be signed out of this simulation.`
      : null,
    verification:
      "This deliberately changes mock session state without contacting an identity provider.",
    counts: allowed ? "1 mock browser session. No real sessions are counted." : null,
    emptyLabel: null,
    confirmLabel: "I understand this ends only the current mock browser session.",
    submitLabel: "End mock browser session",
    cancelLabel: "Cancel",
    submitPath: resourcePath("/settings/sessions", search),
    signInLabel: "Return to mock sign-in",
    signInPath: "/",
  }
  return { setup, register, install, enrollment, authorization, sessions }
}
