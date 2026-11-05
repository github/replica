import { Text } from "@primer/react-brand"

import { HubSpinner } from "@components/hub-spinner"
import { ReplicaLogo } from "@components/replica-logo"

import "./styles.css"

export function SessionLoadingPage() {
  return (
    <main className="session-loading-page" aria-live="polite">
      <ReplicaLogo />
      <div className="session-loading-page__status">
        <HubSpinner decorative />
        <Text as="p">Checking your Hub session…</Text>
      </div>
    </main>
  )
}
