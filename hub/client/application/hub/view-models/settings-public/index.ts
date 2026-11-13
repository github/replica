import type { FreshAuthorizationPageData } from "@pages/fresh-authorization-page/types"
import type { GithubAppSetupInstallPageData } from "@pages/github-app-setup-install-page/types"
import type { GithubAppSetupRegisterPageData } from "@pages/github-app-setup-register-page/types"
import type { HubAdminEnrollmentPageData } from "@pages/hub-admin-enrollment-page/types"
import type { SessionRevocationPageData } from "@pages/session-revocation-page/types"
import type { SettingsPublicResponse } from "@application/hub/settings-contracts/types"

import { resourcePath } from "../resource-path"

export function settingsPublic(state: SettingsPublicResponse, search: URLSearchParams) {
  const shared = { productName: "Replica Hub", authenticityToken: "" }
  const allowed = state.session.capabilities.administerHub
  const signedOut = !state.session.viewer
  const register: GithubAppSetupRegisterPageData = {
    ...shared,
    canContinue: allowed,
    pageTitle: "Create GitHub App",
    heading: "Create the GitHub App",
    description: "Replica Hub uses a private GitHub App to discover and authorize prototypes.",
    access: "You choose which repositories the GitHub App can access.",
    manifest: '{"name":"Replica Hub"}',
    submitLabel: "Create the App on GitHub",
    submitPath: resourcePath("/settings/github/register", search),
  }
  const installed = state.github.state === "installed"
  const install: GithubAppSetupInstallPageData = {
    ...shared,
    pageTitle: installed ? "GitHub connected" : "Install GitHub App",
    heading: installed ? "Replica Hub is connected" : "Install the GitHub App",
    description: "The private GitHub App is ready to install on prototype repositories.",
    canContinue: allowed,
    submitPath: installed ? undefined : resourcePath("/settings/github/installed", search),
    submitLabel: installed ? undefined : "Install GitHub App",
    nextPath: resourcePath("/settings/github", search),
    nextLabel: "GitHub App",
  }
  const enrollment: HubAdminEnrollmentPageData = {
    ...shared,
    canContinue: allowed,
    pageTitle: "Enroll a Hub operator",
    heading: "Enroll a Hub operator",
    description:
      "Enter the deployment's bootstrap secret, then verify your own GitHub account. This grants deployment administration, not access to private repositories.",
    secretLabel: "Bootstrap secret",
    submitLabel: "Verify with GitHub",
    submitPath: resourcePath("/settings/enroll", search),
  }
  const authorization: FreshAuthorizationPageData = {
    ...shared,
    canContinue: !!state.continuation && allowed,
    pageTitle: "Fresh GitHub authorization required",
    heading: state.continuation ? "Fresh GitHub authorization required" : "Nothing to authorize",
    description: state.continuation
      ? "Verify the same GitHub account to continue your confirmed action. GitHub may reuse your signed-in browser; this is not a guaranteed password or MFA challenge."
      : "There is no pending action to authorize. Return to the action and try again.",
    submitLabel: "Verify with GitHub",
    submitPath: resourcePath("/settings/authorize", search),
    cancelLabel: "Cancel",
    cancelPath: state.continuation ? resourcePath("/settings/authorize", search) : undefined,
    continuation: state.continuation ? { id: state.continuation.id, method: "post" } : undefined,
  }
  const sessions: SessionRevocationPageData = {
    heading: signedOut
      ? state.sessionRevoked
        ? "All existing Hub sessions ended"
        : "Sign in to continue"
      : "End all Hub sessions",
    description:
      signedOut && state.sessionRevoked
        ? "Your session has ended. Existing browser sessions and canvas credentials no longer authorize access. Pending connection approvals and signed-in preview handoffs have ended. Sign in again to continue."
        : "Sign everyone out of this Hub and disconnect existing Copilot canvas connections. People can sign in and approve new connections afterward.",
    pageTitle: "End all Hub sessions",
    auditLabel: "Security audit",
    auditPath: allowed ? resourcePath("/settings/audit", search) : null,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    authenticityToken: "",
    signedOut,
    notice: null,
    alert:
      !signedOut && !allowed
        ? "Only a current Hub administrator can end all sessions. No sessions were ended."
        : null,
    canRevoke: allowed,
    scope:
      signedOut && state.sessionRevoked
        ? "Public share links and public previews have not changed. People can sign in and approve new canvas connections."
        : "Hub will end existing browser sessions and revoke canvas access and refresh credentials. Pending canvas approvals and signed-in preview access will end, including existing handoffs. Public share links and public previews will not change.",
    ownSession: allowed
      ? `Your own session (@${state.session.viewer?.login}) will end too. This browser will show the result without requiring another sign-in.`
      : null,
    verification:
      "GitHub must have verified this browser's account within the last five minutes. If verification is required, Hub ends the sessions after it succeeds.",
    counts: null,
    emptyLabel: null,
    confirmLabel: "I understand this will end everyone's sessions, including my own.",
    submitLabel: "End all sessions",
    cancelLabel: "Cancel",
    submitPath: resourcePath("/settings/sessions", search),
    signInLabel: "Return to sign-in",
    signInPath: "/",
  }
  return { register, install, enrollment, authorization, sessions }
}
