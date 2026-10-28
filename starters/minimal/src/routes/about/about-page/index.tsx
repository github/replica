import type { AboutPageProps } from "./types"

export function AboutPage({ homeLink }: AboutPageProps) {
  return (
    <main>
      <h1>About</h1>
      <p>This is an example sub-page reachable via routing. Replace it with your own.</p>
      {homeLink}
    </main>
  )
}
