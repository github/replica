import { useState } from "react"

import { ImprovementThreads } from "@features/prototype-canvas-improvement-threads"
import { sampleThreads } from "./fixtures"
import { copy } from "./en"

export function PrototypeCanvasThreadSample() {
  const [threads, setThreads] = useState(() => structuredClone(sampleThreads))
  const [open, setOpen] = useState(true)
  return (
    <ImprovementThreads
      identity="sample"
      open={open}
      threads={threads.map((thread) => ({
        ...thread,
        author: copy.author,
        revision: 1,
        originalPending: Boolean(thread.originalPending),
        point: { x: `${thread.samplePoint.xPercent}%`, y: `${thread.samplePoint.yPercent}%` },
        messages: thread.messages.map((entry, index) => ({
          ...entry,
          id: String(index),
          status: entry.pending ? "open" : "ready",
        })),
      }))}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onFollowUp={(thread, body) => {
        setThreads((items) =>
          items.map((item) =>
            item.id === thread.id
              ? {
                  ...item,
                  status: "open",
                  messages: [...item.messages, { role: "author", body, pending: true }],
                }
              : item,
          ),
        )
        return Promise.resolve(true)
      }}
      onResolve={(thread) => {
        setThreads((items) =>
          items.map((item) => (item.id === thread.id ? { ...item, status: "resolved" } : item)),
        )
        return Promise.resolve(true)
      }}
      onDelete={(thread) => {
        setThreads((items) => items.filter((item) => item.id !== thread.id))
        return Promise.resolve(true)
      }}
      onFix={() => {
        setThreads((items) =>
          items.map((item) =>
            item.originalPending || item.messages.some((entry) => entry.pending)
              ? {
                  ...item,
                  originalPending: false,
                  status: "ready",
                  messages: [
                    ...item.messages.map((entry) => ({ ...entry, pending: false })),
                    { role: "copilot", body: copy.simulatedAnswer },
                  ],
                }
              : item,
          ),
        )
        return Promise.resolve(true)
      }}
    />
  )
}
