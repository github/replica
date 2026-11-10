import { Button, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubAdministrationPage } from "@features/hub-administration-page"

import type { HubAdminConfirmationPageData } from "./types"
import "./styles.css"

/** Makes the target and consequence explicit before a CSRF-protected role change. */
export function HubAdminConfirmationPage({
  data,
  pending = false,
}: {
  data: HubAdminConfirmationPageData
  pending?: boolean
}) {
  return (
    <HubAdministrationPage data={data}>
      <section aria-label={data.target.login ?? data.target.membershipId}>
        <strong>{data.target.name ?? data.target.login ?? "Profile unavailable"}</strong>
        <Text as="p">{data.target.login ? `@${data.target.login}` : "Login unavailable"}</Text>
        <Text as="p">{data.target.identity}</Text>
        <Text as="p" size="100">
          Membership {data.target.membershipId}
        </Text>
      </section>

      <Text as="p">{data.verification}</Text>
      {data.blockedLabel ? <HubAlert variant="warning" title={data.blockedLabel} /> : null}

      <form action={data.submitPath} method="post" className="hub-admin-confirmation-page__form">
        {data.targetMembershipId ? null : (
          <>
            <input type="hidden" name="_method" value="patch" />
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
          </>
        )}
        <input type="hidden" name="operation" value={data.operation} />
        {data.targetMembershipId ? (
          <input type="hidden" name="targetMembershipIds" value={data.targetMembershipId} />
        ) : null}

        <label className="hub-admin-confirmation-page__confirmation">
          <input
            type="checkbox"
            name="confirmed"
            value="1"
            required
            disabled={!!data.blockedLabel || pending}
          />
          <span>{data.confirmLabel}</span>
        </label>

        <div className="hub-administration-page__actions">
          <Button as="a" href={data.cancelPath} variant="secondary">
            {data.cancelLabel}
          </Button>
          <Button type="submit" variant="primary" disabled={!!data.blockedLabel || pending}>
            {data.submitLabel}
          </Button>
        </div>
      </form>
    </HubAdministrationPage>
  )
}
