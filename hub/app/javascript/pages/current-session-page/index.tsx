import { Button, Heading, Text } from "@primer/react-brand"

import { ReplicaLogo } from "@components/replica-logo"

import type { CurrentSessionPageData } from "./types"
import "./styles.css"

export function CurrentSessionPage({ data }: { data: CurrentSessionPageData }) {
  return (
    <main className="current-session-page">
      <ReplicaLogo />
      <section className="current-session-page__card">
        <Heading as="h1" size="3">
          {data.heading}
        </Heading>
        <Text as="p">{data.description}</Text>
        <Text as="p">
          <strong>{data.roleLabel}</strong>
        </Text>
        <form action={data.signOutPath} method="post">
          <Button type="submit" variant="primary">
            {data.signOutLabel}
          </Button>
        </form>
      </section>
    </main>
  )
}
