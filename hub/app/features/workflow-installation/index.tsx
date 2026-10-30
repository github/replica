import { WorkflowIcon } from "@primer/octicons-react"
import { Button, Heading, Text } from "@primer/react-brand"

import type { WorkflowInstallationData } from "./types"

import "./styles.css"

/** Keeps workflow onboarding states consistent wherever repository setup is shown. */
export function WorkflowInstallation({
  authenticityToken,
  data,
}: {
  authenticityToken: string
  data: WorkflowInstallationData
}) {
  return (
    <section className="workflow-installation">
      <div className="workflow-installation__layout">
        <WorkflowIcon className="workflow-installation__icon" size={20} />

        <div className="workflow-installation__content">
          <Heading as="h2" size="6" className="workflow-installation__heading">
            {data.heading}
          </Heading>

          <Text as="p" className="workflow-installation__description">
            {data.description}
          </Text>

          {data.state === "installable" || data.state === "updatable" ? (
            <form
              action={data.createPath}
              method="post"
              aria-label={data.actionLabel}
              className="workflow-installation__action"
            >
              <input type="hidden" name="authenticity_token" value={authenticityToken} />

              <Button type="submit" variant="primary">
                {data.actionLabel}
              </Button>
            </form>
          ) : null}

          {data.state === "requiresWriter" && data.documentationUrl && data.documentationLabel ? (
            <Button
              as="a"
              href={data.documentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="workflow-installation__action"
            >
              {data.documentationLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
