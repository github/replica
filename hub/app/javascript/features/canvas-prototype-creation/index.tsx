import { Button, Heading } from "@primer/react-brand"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

import { HubAlert } from "@components/hub-alert"
import { CanvasServerConnection } from "@features/canvas-server-connection"
import { PrototypeCreationForm } from "@features/prototype-creation-form"
import type { PrototypeCreationData } from "@features/prototype-creation-form/types"
import type { HubStatus } from "@utils/prototype-canvas/types"
import { request } from "@utils/prototype-canvas-request"

import { creationCopy as copy } from "./en"
import "./styles.css"

const catalogSchema = z.object({
  templates: z.array(z.object({ id: z.string(), name: z.string(), route: z.string() })).min(1),
  promptInstructions: z.string(),
  templatePageInstructions: z.string(),
  templateLandingPageInstructions: z.string(),
  copy: z.object({
    heading: z.string(),
    descriptionPlaceholder: z.string(),
    templateLabel: z.string(),
    previewUnavailable: z.string(),
    addDetails: z.string(),
    editDetails: z.string(),
    detailsHeading: z.string(),
    detailsDescription: z.string(),
    changeLabel: z.string(),
    changePlaceholder: z.string(),
    audienceLabel: z.string(),
    audiencePlaceholder: z.string(),
    outcomeLabel: z.string(),
    outcomePlaceholder: z.string(),
    closeDetails: z.string(),
    saveDetails: z.string(),
    submitLabel: z.string(),
  }),
})

/** Starts a brief in the existing conversation without requiring a running preview. */
export function CanvasPrototypeCreation({
  token,
  status,
  onConnect,
}: {
  token: string
  status: HubStatus | null
  onConnect: () => void
}) {
  const [data, setData] = useState<PrototypeCreationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [catalogError, setCatalogError] = useState("")
  const [submissionError, setSubmissionError] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const connected = status?.state === "connected" || status?.state === "undiscovered"

  useEffect(() => {
    if (!connected) return
    let disposed = false
    async function load() {
      setLoading(true)
      setCatalogError("")
      try {
        const result = catalogSchema.parse(await request<unknown>("/api/prototypes/new", token))
        if (!disposed) setData(result)
      } catch (cause) {
        if (!disposed) setCatalogError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [connected, token, revision])

  return (
    <div className="canvas-prototype-creation">
      <div className="canvas-prototype-creation__content">
        {connected && data ? (
          <PrototypeCreationForm
            data={data}
            busy={busy || loading || Boolean(catalogError)}
            onChange={() => {
              setSent(false)
              setSubmissionError("")
            }}
            onSubmit={async ({ brief, details, templateId }) => {
              if (sending.current) return
              sending.current = true
              setBusy(true)
              setSent(false)
              setSubmissionError("")
              try {
                await request("/api/prototypes/new", token, {
                  method: "POST",
                  body: JSON.stringify({ brief, details, templateId }),
                })
                setSent(true)
              } catch (cause) {
                setSubmissionError(cause instanceof Error ? cause.message : String(cause))
              } finally {
                sending.current = false
                setBusy(false)
              }
            }}
          />
        ) : (
          <Heading as="h1" size="5" weight="normal" className="new-prototype__heading">
            {copy.heading}
          </Heading>
        )}
        {!status || (connected && loading) ? <p role="status">{copy.loading}</p> : null}
        {status && !connected ? (
          <div className="canvas-prototype-creation__notice">
            <p>
              {["unconfigured", "disconnected", "pairing"].includes(status.state)
                ? copy.disconnected
                : status.message || copy.unavailable}
            </p>
            <Button type="button" variant="secondary" size="small" onClick={onConnect}>
              {copy.connect}
            </Button>
          </div>
        ) : null}
        {connected && catalogError ? (
          <div className="canvas-prototype-creation__notice">
            <HubAlert
              variant="critical"
              layout="compact"
              title={catalogError}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {copy.retry}
                </Button>
              }
            />
          </div>
        ) : null}
        {submissionError ? (
          <>
            <HubAlert
              variant="critical"
              layout="compact"
              title={submissionError}
              action={
                <Button
                  type="button"
                  variant="subtle"
                  size="small"
                  disabled={loading}
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {copy.retry}
                </Button>
              }
            />
          </>
        ) : null}
        {busy || sent ? <p role="status">{busy ? copy.sending : copy.sent}</p> : null}
      </div>
      <CanvasServerConnection token={token} />
    </div>
  )
}
