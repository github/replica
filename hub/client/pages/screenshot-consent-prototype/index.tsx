import { useId, useState } from "react"
import { Button, Checkbox, FormControl, Heading, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"

import type { ScreenshotConsentPrototypeData } from "./types"
import "./styles.css"

function SampleScreenshot({ kind }: { kind: "before" | "after" }) {
  const isAfter = kind === "after"
  const description = isAfter
    ? "Example after image showing a checkout form with a visible email label."
    : "Example before image showing a checkout form where the email name is placeholder text."

  return (
    <div
      className={`screenshot-consent__sample screenshot-consent__sample--${kind}`}
      role="img"
      aria-label={description}
    >
      <div className="screenshot-consent__sample-bar">
        <span>checkout.example</span>
        <span aria-hidden="true">● ● ●</span>
      </div>
      <div className="screenshot-consent__sample-content">
        <p className="screenshot-consent__sample-brand">Northstar</p>
        <h3>Checkout</h3>
        <p>Contact details</p>
        <div className="screenshot-consent__sample-field">
          {isAfter ? <span>Email address</span> : null}
          <div>{isAfter ? "name@example.com" : "Email address"}</div>
        </div>
        <div className="screenshot-consent__sample-order">
          <span>Notebook</span>
          <span>$12.00</span>
        </div>
        <div className="screenshot-consent__sample-button">Continue</div>
      </div>
    </div>
  )
}

function ScreenshotExamples() {
  return (
    <section className="screenshot-consent__evidence" aria-label="Example screenshots">
      <div className="screenshot-consent__examples">
        {(["before", "after"] as const).map((kind) => (
          <figure className="screenshot-consent__example" key={kind}>
            <figcaption>{kind === "before" ? "Before" : "After"}</figcaption>
            <SampleScreenshot kind={kind} />
          </figure>
        ))}
      </div>
    </section>
  )
}

export function ScreenshotConsentPrototype({ data }: { data: ScreenshotConsentPrototypeData }) {
  const consentId = useId()
  const [consent, setConsent] = useState(data.consent)
  const [consentEvaluatorName, setConsentEvaluatorName] = useState(data.consentEvaluatorName)
  const [recordedAt, setRecordedAt] = useState(data.consentRecordedAt)
  const needsRenewal = consent === true && consentEvaluatorName !== data.evaluatorName
  const currentConsent = needsRenewal ? null : consent
  const [draft, setDraft] = useState(currentConsent ?? false)
  const [withdrawn, setWithdrawn] = useState(false)

  const firstUse = currentConsent === null
  const changed = draft !== currentConsent
  // Turning off a saved permission must say what happens to images already
  // captured, so it gets its own wording instead of an ordinary save.
  const withdrawing = currentConsent === true && !draft

  function save() {
    setWithdrawn(withdrawing)
    setConsent(draft)
    setConsentEvaluatorName(data.evaluatorName)
    setRecordedAt("Just now")
  }

  return (
    <div className="screenshot-consent-page">
      <header className="repository-page-header screenshot-consent__page-header">
        <Heading as="h1" size="6">
          Screenshot sharing
        </Heading>
      </header>

      <div className="screenshot-consent">
        <Text as="p" className="screenshot-consent__intro">
          Choose whether your agent can capture screenshots like these and send them to the system
          for automated review.
        </Text>

        <ScreenshotExamples />

        <div className="screenshot-consent__choice">
          <FormControl id={consentId}>
            <Checkbox
              checked={draft}
              disabled={!data.evaluationAvailable && currentConsent !== true}
              onChange={(event) => setDraft(event.currentTarget.checked)}
            />
            <FormControl.Label>Allow screenshot capture and automated review</FormControl.Label>
            {needsRenewal || !data.evaluationAvailable || withdrawing ? (
              <FormControl.Hint>
                {needsRenewal
                  ? "Your previous permission does not cover the system. Choose again before sharing screenshots. "
                  : null}
                {!data.evaluationAvailable
                  ? "Your repository admin has not enabled automated evaluation. "
                  : null}
                {withdrawing
                  ? "This stops further use and requests deletion. Copies may take time to remove."
                  : null}
              </FormControl.Hint>
            ) : null}
          </FormControl>

          {withdrawn && !changed ? (
            <HubAlert
              variant="info"
              layout="compact"
              title="Screenshot permission withdrawn"
              description="Further use is stopped. Deletion has been requested; copies may take time to remove."
            />
          ) : null}

          {firstUse ? null : (
            <p className="screenshot-consent__record">
              {withdrawn ? "Withdrawn" : "Recorded"} by {data.personName} · {recordedAt}
            </p>
          )}

          {firstUse || changed ? (
            <div className="screenshot-consent__actions">
              {firstUse ? null : (
                <Button size="small" onClick={() => setDraft(currentConsent ?? false)}>
                  Cancel
                </Button>
              )}
              <Button variant="primary" size="small" onClick={save}>
                {withdrawing
                  ? "Withdraw and request deletion"
                  : draft
                    ? "Save permission"
                    : "Decline screenshot permission"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
