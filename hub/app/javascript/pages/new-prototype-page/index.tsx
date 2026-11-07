import { useRef, useState } from "react"

import { CopilotAppContinuationDialog } from "@components/copilot-app-continuation-dialog"
import type { CopilotAppSubmission } from "@components/copilot-app-continuation/types"
import { HubAlert } from "@components/hub-alert"
import { PrototypeCreationForm } from "@features/prototype-creation-form"
import { RepositoryWorkspace } from "@features/repository-workspace"
import { TemplateCatalog } from "@features/template-catalog"
import { createPrototypeSubmission } from "@utils/create-prototype-submission"

import type { NewPrototypePageData } from "./types"
import "./styles.css"

/** Collects a prototype brief for prompt copying or a Copilot app handoff. */
export function NewPrototypePage({
  data,
  onOpenApp,
}: {
  data: NewPrototypePageData
  onOpenApp?: (url: string) => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [submission, setSubmission] = useState<(CopilotAppSubmission & { id: number }) | null>(null)
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | null>(null)
  const submissionId = useRef(0)
  const draftRevision = useRef(0)
  const { copy } = data

  return (
    <RepositoryWorkspace data={data}>
      <div className="new-prototype">
        <div ref={content} className="new-prototype__content">
          <PrototypeCreationForm
            data={data}
            onChange={() => {
              draftRevision.current += 1
              setCopyStatus(null)
            }}
            onDialogChange={setDetailsOpen}
            onSubmit={async ({ prompt }) => {
              if (data.submissionMode === "copy") {
                const revision = draftRevision.current
                setCopyStatus(null)
                try {
                  await navigator.clipboard.writeText(prompt)
                  if (draftRevision.current === revision) setCopyStatus("copied")
                } catch {
                  if (draftRevision.current === revision) setCopyStatus("error")
                }
                return
              }
              submissionId.current += 1
              setSubmission({
                id: submissionId.current,
                ...createPrototypeSubmission({ repositoryName: data.repositoryName, prompt }),
              })
            }}
          />
          {data.submissionMode === "copy" && copyStatus ? (
            <HubAlert
              className="new-prototype__copy-status"
              variant={copyStatus === "copied" ? "success" : "critical"}
              layout="compact"
              title={copyStatus === "copied" ? copy.copiedLabel : copy.copyErrorLabel}
            />
          ) : null}
          {submission ? (
            <CopilotAppContinuationDialog
              key={submission.id}
              submission={submission}
              copy={copy}
              onOpenApp={onOpenApp}
              onClose={() => {
                setSubmission(null)
                content.current?.querySelector("textarea")?.focus()
              }}
            />
          ) : null}
        </div>
        <div className="new-prototype__catalog">
          <TemplateCatalog
            data={{ ...data.catalog, templates: data.templates }}
            searchShortcutEnabled={!detailsOpen && !submission}
          />
        </div>
      </div>
    </RepositoryWorkspace>
  )
}
