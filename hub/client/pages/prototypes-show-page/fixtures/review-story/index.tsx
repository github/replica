import { useState } from "react"

import { useHubTheme } from "@hooks/use-hub-theme"
import { PrototypesShowPage } from "@/pages/prototypes-show-page"
import type {
  PrototypePreviewOnlyPageProps,
  PrototypesShowPageProps,
} from "@/pages/prototypes-show-page/types"

export function ReviewStory(props: PrototypesShowPageProps | PrototypePreviewOnlyPageProps) {
  const { resolvedColorMode } = useHubTheme()
  const review = props.review
  const [sidebarOpen, setSidebarOpen] = useState(review?.sidebarOpen ?? false)
  const [selectedThread, setSelectedThread] = useState(review?.selectedThread ?? null)

  function toggleSidebar() {
    if (review?.conversationDraftActive) return

    if (sidebarOpen) setSelectedThread(null)
    setSidebarOpen(!sidebarOpen)
  }

  if (!props.review) {
    return <PrototypesShowPage {...props} previewTheme={resolvedColorMode} />
  }

  return (
    <PrototypesShowPage
      {...props}
      previewTheme={resolvedColorMode}
      review={{
        ...props.review,
        sidebarOpen,
        selectedThread,
        selectedThreadId: selectedThread?.root.id ?? null,
        setSidebarOpen,
        toggleSidebar,
        closeThread: () => setSelectedThread(null),
        selectThread: (thread) => {
          setSelectedThread(thread)
        },
      }}
    />
  )
}
