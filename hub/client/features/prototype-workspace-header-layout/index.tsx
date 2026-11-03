import { Heading, Stack } from "@primer/react-brand"
import type { PropsWithChildren, ReactNode } from "react"

import "./styles.css"

export function PrototypeWorkspaceHeaderLayout({
  author,
  title,
  identityTrailing,
  children,
}: PropsWithChildren<{
  author?: ReactNode
  title: ReactNode
  identityTrailing?: ReactNode
}>) {
  return (
    <header className="review-shell__header">
      <Stack
        direction="horizontal"
        alignItems="center"
        gap="condensed"
        className="review-shell__identity"
      >
        {author}
        <Stack
          direction="horizontal"
          alignItems="center"
          gap="condensed"
          className="review-shell__name"
        >
          <Heading as="h1" size="5" className="review-shell__branch">
            {title}
          </Heading>
          {identityTrailing}
        </Stack>
      </Stack>
      <div className="review-shell__actions">{children}</div>
    </header>
  )
}
