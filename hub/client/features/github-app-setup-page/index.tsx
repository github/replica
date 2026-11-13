import type { PropsWithChildren } from "react"

import "./styles.css"

export function GithubAppSetupPage({
  children,
  width = "narrow",
}: PropsWithChildren<{ width?: "narrow" | "wide" }>) {
  return (
    <main className="setup">
      <section className={`setup__card${width === "wide" ? " setup__card--wide" : ""}`}>
        <div className="setup__content">{children}</div>
      </section>
    </main>
  )
}
