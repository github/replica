import { Button, Heading, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubAdministrationPage } from "@features/hub-administration-page"

import type { SharingSettingsPageData } from "./types"
import "./styles.css"

/** Keeps the consequence and explicit confirmation beside the deployment control. */
export function SharingSettingsPage({
  data,
  busy = false,
}: {
  data: SharingSettingsPageData
  busy?: boolean
}) {
  return (
    <HubAdministrationPage data={data}>
      {data.accessDenied ? (
        <Text as="p">{data.emptyLabel}</Text>
      ) : (
        <section className="sharing-settings-page__control">
          <Heading as="h2" size="5">
            {data.statusLabel}
          </Heading>
          {data.operation === "enable" ? <Text as="p">{data.emptyLabel}</Text> : null}
          <HubAlert title={data.consequence} variant="warning" />
          <Text as="p">{data.verification}</Text>

          <form
            key={data.operation}
            action={data.submitPath}
            method="post"
            className="sharing-settings-page__form"
            aria-busy={busy}
          >
            <input type="hidden" name="_method" value="patch" />
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
            <input type="hidden" name="operation" value={data.operation} />

            <label className="sharing-settings-page__confirmation">
              <input type="checkbox" name="confirmed" value="1" required disabled={busy} />
              <span>{data.confirmLabel}</span>
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              {data.submitLabel}
            </Button>
          </form>
        </section>
      )}
    </HubAdministrationPage>
  )
}
