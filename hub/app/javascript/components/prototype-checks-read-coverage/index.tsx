import { Button } from "@primer/react-brand"
import { useState } from "react"

import type { CheckReadCoverage } from "@utils/prototype-checks/types"
import { readCoverageCopy as copy } from "./en"

import "./styles.css"

export function ChecksReadCoverage({ coverage }: { coverage?: CheckReadCoverage | null }) {
  const [visible, setVisible] = useState(25)
  if (!coverage) return <p>{copy.missing}</p>

  const required = coverage.files.filter((file) => file.required)
  const read = required.filter((file) => file.status === "read")
  const files = [
    ...required.filter((file) => file.status !== "read"),
    ...read,
    ...coverage.files.filter((file) => !file.required),
  ]
  return (
    <details className="canvas-check-read-coverage">
      <summary>{copy.summary(read.length, required.length)}</summary>
      <p>{copy.description}</p>
      <ul>
        {files.slice(0, visible).map((file) => (
          <li key={file.file}>
            <code>{file.file}</code>
            <span>{copy.status[file.status]}</span>
            <small>
              {!file.required
                ? copy.asset
                : file.reason
                  ? copy.reason[file.reason]
                  : copy.bytes(file.readBytes, file.totalBytes)}
            </small>
            {file.status === "partial" ? (
              <small>{copy.bytes(file.readBytes, file.totalBytes)}</small>
            ) : null}
          </li>
        ))}
      </ul>
      {files.length > visible ? (
        <Button size="small" variant="secondary" onClick={() => setVisible((count) => count + 25)}>
          {copy.more(Math.min(25, files.length - visible))}
        </Button>
      ) : null}
    </details>
  )
}
