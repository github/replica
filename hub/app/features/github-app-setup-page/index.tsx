import type { PropsWithChildren } from "react"

import "./styles.css"

export function GithubAppSetupPage({ children }: PropsWithChildren) {
  return (
    <main className="setup">
      <section className="setup__card">
        <div className="setup__content">{children}</div>
      </section>
    </main>
  )
}
