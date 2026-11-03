import { Button, Heading, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubAdministrationPage } from "@features/hub-administration-page"

import type { CopilotConnectionPageData } from "./types"
import "./styles.css"

/** Shows who connected Copilot, whether Hub has a token, and each change's consequence beside its confirmation. */
export function CopilotConnectionPage({ data }: { data: CopilotConnectionPageData }) {
  return (
    <HubAdministrationPage data={data}>
      {data.accessDenied ? (
        <Text as="p">{data.emptyLabel}</Text>
      ) : (
        <div className="copilot-connection-page">
          <section className="copilot-connection-page__section">
            <Heading as="h2" size="5">
              {data.statusLabel}
            </Heading>
            {data.connected ? (
              <>
                <Text as="p">{data.connectedBy}</Text>
                <Text as="p">{data.verifiedLabel}</Text>
                {data.usageLabel ? <Text as="p">{data.usageLabel}</Text> : null}
              </>
            ) : (
              <Text as="p">{data.emptyLabel}</Text>
            )}
            {data.tokenLabel ? <HubAlert title={data.tokenLabel} variant="warning" /> : null}
            {data.refusedLabel ? <HubAlert title={data.refusedLabel} variant="critical" /> : null}
          </section>

          {data.connect ? (
            <section className="copilot-connection-page__section">
              <HubAlert title={data.connect.consequence} variant="info" />
              <Text as="p">{data.connect.verification}</Text>
              <form
                action={data.submitPath}
                method="post"
                className="copilot-connection-page__form"
              >
                <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                <label className="copilot-connection-page__confirmation">
                  <input type="checkbox" name="confirmed" value="1" required />
                  <span>{data.connect.confirmLabel}</span>
                </label>
                <Button type="submit" variant="primary">
                  {data.connect.label}
                </Button>
              </form>
            </section>
          ) : null}

          {data.disconnect ? (
            <section className="copilot-connection-page__section">
              <HubAlert title={data.disconnect.consequence} variant="warning" />
              <Text as="p">{data.disconnect.verification}</Text>
              <form
                action={data.submitPath}
                method="post"
                className="copilot-connection-page__form"
              >
                <input type="hidden" name="_method" value="delete" />
                <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                <label className="copilot-connection-page__confirmation">
                  <input type="checkbox" name="confirmed" value="1" required />
                  <span>{data.disconnect.confirmLabel}</span>
                </label>
                <Button type="submit" variant="secondary">
                  {data.disconnect.label}
                </Button>
              </form>
            </section>
          ) : null}
        </div>
      )}
    </HubAdministrationPage>
  )
}
