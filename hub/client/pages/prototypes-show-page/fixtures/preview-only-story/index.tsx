import { useHubTheme } from "@hooks/use-hub-theme"
import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { PrototypesShowPage } from "@/pages/prototypes-show-page"
import type {
  PrototypePreviewOnlyPageProps,
  PrototypesShowPageProps,
} from "@/pages/prototypes-show-page/types"

export function PreviewOnlyStory(props: PrototypesShowPageProps | PrototypePreviewOnlyPageProps) {
  const { resolvedColorMode } = useHubTheme()
  const bridge = usePreviewBridge({
    iframeRef: props.iframeRef,
    previewUrl: props.data.selectedBuild?.previewUrl,
    previewTheme: resolvedColorMode,
    anchors: [],
    reviewEnabled: false,
  })

  return (
    <PrototypesShowPage
      {...props}
      review={undefined}
      previewBridge={bridge}
      previewTheme={resolvedColorMode}
      reviewUnavailableLabel="Review conversations are unavailable. Try reloading the page."
    />
  )
}
