import { MarkGithubIcon } from "@primer/octicons-react"
import { Button, Heading, InlineLink, Text } from "@primer/react-brand"

import { HubToast } from "@components/hub-toast"

import type { CanvasPairingsPageData } from "./types"

import "./styles.css"

/** Frames the one-time browser approval and its revocable connections in Hub's theme. */
export function CanvasPairingsPage({
  data,
  busy = false,
}: {
  data: CanvasPairingsPageData
  busy?: boolean
}) {
  return (
    <main className="canvas-pairings">
      <div className="canvas-pairings__frame">
        <header className="canvas-pairings__brand">
          <MarkGithubIcon size={20} aria-hidden="true" />
          <Text weight="semibold">{data.productName}</Text>
        </header>

        <section className="canvas-pairings__card">
          <Heading as="h1" size="3">
            {data.heading}
          </Heading>
          <Text as="p" className="canvas-pairings__description">
            {data.description}
          </Text>

          {data.kind === "approval" ? (
            <>
              <div className="canvas-pairings__code">
                <Text as="span" className="canvas-pairings__label">
                  {data.codeLabel}
                </Text>
                <code>{data.code}</code>
              </div>
              <Text as="p" className="canvas-pairings__explanation">
                {data.codeInstruction}
                {data.codeExpiresLabel ? ` ${data.codeExpiresLabel}` : null}
              </Text>
              <div className="canvas-pairings__repository">
                <Text as="span" className="canvas-pairings__label">
                  {data.repositoryLabel}
                </Text>
                <strong>{data.repository}</strong>
              </div>
              <Text as="p" className="canvas-pairings__explanation">
                {data.permissions}
              </Text>
              <Text as="p" className="canvas-pairings__explanation">
                {data.expiration}{" "}
                <InlineLink href={data.connectionsPath}>{data.connectionsLabel}</InlineLink>.
              </Text>

              <form action={data.approvePath} method="post" className="canvas-pairings__actions">
                {data.authenticityToken !== undefined ? (
                  <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                ) : null}
                {data.learningsConsentVersion !== undefined ? (
                  <input
                    type="hidden"
                    name="learnings_consent_version"
                    value={data.learningsConsentVersion}
                  />
                ) : null}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || data.canApprove === false}
                >
                  {data.approveLabel}
                </Button>
                <Button as="a" href={data.cancelPath} variant="secondary">
                  {data.cancelLabel}
                </Button>
              </form>
            </>
          ) : (
            <>
              {data.notice ? <HubToast title={data.notice} /> : null}
              {data.createPath && data.createLabel ? (
                <Button as="a" href={data.createPath} variant="primary">
                  {data.createLabel}
                </Button>
              ) : null}
              {data.grants.length ? (
                <ul className="canvas-pairings__grants">
                  {data.grants.map((grant) => (
                    <li key={grant.id} className="canvas-pairings__grant">
                      <div>
                        <strong>{grant.repository}</strong>
                        <Text as="p" className="canvas-pairings__explanation">
                          {grant.expiresLabel}
                        </Text>
                      </div>
                      <form action={grant.revokePath} method="post">
                        <input type="hidden" name="_method" value="delete" />
                        {data.authenticityToken !== undefined ? (
                          <input
                            type="hidden"
                            name="authenticity_token"
                            value={data.authenticityToken}
                          />
                        ) : null}
                        <Button type="submit" variant="secondary" size="small" disabled={busy}>
                          {data.revokeLabel}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text as="p" className="canvas-pairings__explanation">
                  {data.emptyLabel}
                </Text>
              )}
              <Button as="a" href={data.backPath} variant="secondary">
                {data.backLabel}
              </Button>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
