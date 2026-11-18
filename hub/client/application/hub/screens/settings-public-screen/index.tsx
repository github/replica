import { FreshAuthorizationPage } from "@pages/fresh-authorization-page"
import { GithubAppSetupInstallPage } from "@pages/github-app-setup-install-page"
import { GithubAppSetupRegisterPage } from "@pages/github-app-setup-register-page"
import { HubAdminEnrollmentPage } from "@pages/hub-admin-enrollment-page"
import { SessionRevocationPage } from "@pages/session-revocation-page"
import type {
  SettingsPublicResponse,
  SettingsSection,
} from "@application/hub/settings-contracts/types"
import { settingsPublic } from "@application/hub/view-models/settings-public"

export function SettingsPublicScreen({
  section,
  state,
  search,
}: {
  section: SettingsSection
  state: SettingsPublicResponse
  search: URLSearchParams
}) {
  const views = settingsPublic(state, search)
  switch (section) {
    case "github-register":
      return <GithubAppSetupRegisterPage data={views.register} />
    case "github-installed":
      return <GithubAppSetupInstallPage data={views.install} />
    case "enrollment":
      return <HubAdminEnrollmentPage data={views.enrollment} />
    case "authorize":
      return <FreshAuthorizationPage data={views.authorization} />
    case "sessions":
      return <SessionRevocationPage data={views.sessions} />
    default:
      throw new Error("A private settings page was mounted in the public settings surface.")
  }
}
