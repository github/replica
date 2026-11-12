import type { ReactNode, Ref } from "react"

import { Heading, Text } from "@primer/react-brand"

import "./styles.css"

export function HubContentPageHeader({
  title,
  description,
  trailing,
  headingAs = "h2",
  headingRef,
}: {
  title: string
  description?: string
  trailing?: ReactNode
  headingAs?: "h1" | "h2"
  headingRef?: Ref<HTMLHeadingElement>
}) {
  return (
    <header className="hub-content-page-header">
      <div className="hub-content-page-header__top">
        <Heading as={headingAs} size="4" ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title}
        </Heading>

        {trailing}
      </div>

      {description ? (
        <Text as="p" className="hub-content-page-header__description">
          {description}
        </Text>
      ) : null}
    </header>
  )
}
