import { MarkGithubIcon } from "@primer/octicons-react"
import { Heading, Text } from "@primer/react-brand"

import type { GithubAppSetupHeaderData } from "./types"

import "./styles.css"

export function GithubAppSetupHeader({ data }: { data: GithubAppSetupHeaderData }) {
  return (
    <div className="setup-header">
      <div className="setup-header__identity">
        <MarkGithubIcon size={20} />
        <strong>{data.productName}</strong>
      </div>

      <Heading as="h1" size="3" className="setup__heading">
        {data.heading}
      </Heading>

      <Text as="p" className="setup__description">
        {data.description}
      </Text>
    </div>
  )
}
