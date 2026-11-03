import { Button, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubAdministrationPage } from "@features/hub-administration-page"

import type { SessionRevocationPageData } from "./types"
import "./styles.css"

/** Requires deliberate confirmation and keeps the signed-out result on this page. */
export function SessionRevocationPage({ data }: { data: SessionRevocationPageData }) {
  return (
    <HubAdministrationPage data={data}>
      <Text as="p">{data.scope}</Text>

      {data.signedOut ? (
        <Button as="a" href={data.signInPath} variant="primary">
          {data.signInLabel}
        </Button>
      ) : null}

      {data.canRevoke ? (
        <div className="session-revocation-page__confirmation">
          {data.ownSession ? <HubAlert variant="warning" title={data.ownSession} /> : null}
          {data.counts ? <Text as="p">{data.counts}</Text> : null}
          {data.emptyLabel ? <Text as="p">{data.emptyLabel}</Text> : null}
          <Text as="p">{data.verification}</Text>

          <form action={data.submitPath} method="post" className="session-revocation-page__form">
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
            <label className="session-revocation-page__checkbox">
              <input type="checkbox" name="confirmed" value="1" required />
              <span>{data.confirmLabel}</span>
            </label>

            <div className="hub-administration-page__actions">
              <Button type="submit" name="cancelled" value="1" formNoValidate variant="secondary">
                {data.cancelLabel}
              </Button>
              <Button type="submit" variant="primary">
                {data.submitLabel}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </HubAdministrationPage>
  )
}
