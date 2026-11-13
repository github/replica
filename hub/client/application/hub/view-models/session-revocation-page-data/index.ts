import type { SessionRevocationPageData } from "@pages/session-revocation-page/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import type { SessionRevocationStatus } from "@application/hub/session-revocation-contracts/types"

import { administratorWorkspace } from "../administrator-workspace"

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function sessionRevocationPageData(
  session: CurrentHubSession | null,
  status: SessionRevocationStatus | null,
  input: {
    authorizationId?: string
    error?: string | null
    notice?: string | null
    result?: "ended"
  } = {},
): SessionRevocationPageData {
  const ended = input.result === "ended"
  const verified = !!input.authorizationId
  const counts = status
    ? [
        countLabel(status.activeSessionCount, "active browser session", "active browser sessions"),
        countLabel(status.pendingAuthenticationCount, "in-flight sign-in", "in-flight sign-ins"),
        countLabel(
          status.pendingSensitiveAuthorizationCount,
          "pending sensitive authorization",
          "pending sensitive authorizations",
        ),
      ].join(", ")
    : null
  return {
    administrationWorkspace: session ? administratorWorkspace(session, "sessions") : null,
    authenticatedWorkspace: null,
    pageTitle: ended ? "All existing Hub sessions ended" : "End all Hub sessions",
    heading: ended ? "All existing Hub sessions ended" : "End all Hub sessions",
    description: ended
      ? "Your session ended with every other existing Hub session. People can sign in again to continue."
      : verified
        ? "Your authentication provider verified this browser. Review the current counts, then end every existing Hub session or cancel without changing access."
        : "Sign everyone out of this Hub. People can sign in again afterward.",
    auditLabel: "Security audit",
    auditPath: session ? "/settings/audit?scope=hub" : null,
    repositoriesLabel: ended ? "Return to sign-in" : "Home",
    repositoriesPath: "/",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    authenticityToken: "",
    signedOut: ended,
    notice: input.notice ?? null,
    alert: input.error ?? null,
    canRevoke: !!session && !ended,
    scope: ended
      ? "The global session revision advanced. Existing sessions and pending authentication or sensitive authorization state no longer authorize access. Product data and public links did not change."
      : "Hub will advance the global session revision, end every active browser session, and invalidate pending sign-ins and sensitive authorizations. Product data and public links will not change.",
    ownSession: session
      ? `Your own session (@${session.login}) will end too. This browser will keep the completion result visible.`
      : null,
    verification: verified
      ? "The authorization is verified and can be used once before it expires."
      : `Hub will ask ${session?.provider ?? "your authentication provider"} to verify the same account before the change.`,
    counts,
    emptyLabel:
      status?.activeSessionCount === 1 &&
      status.pendingAuthenticationCount === 0 &&
      status.pendingSensitiveAuthorizationCount === 0
        ? "No other active sessions or pending authorization attempts are present. Your own session will still end."
        : null,
    confirmLabel: verified
      ? null
      : "I understand this will end everyone's sessions, including my own.",
    authorizationId: input.authorizationId ?? null,
    submitLabel: verified ? "End all sessions now" : "Verify and continue",
    cancelLabel: "Cancel",
    submitPath: verified
      ? "/api/session-revocation/authorizations/continue"
      : "/api/session-revocation/authorizations/start",
    signInLabel: "Return to sign-in",
    signInPath: "/",
  }
}
