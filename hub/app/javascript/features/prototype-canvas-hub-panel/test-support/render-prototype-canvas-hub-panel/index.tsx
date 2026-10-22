import { ThemeProvider } from "@primer/react-brand"
import { render } from "@testing-library/react"
import { createRef, type ComponentProps, type ReactNode } from "react"

import { PrototypeCanvasHubPanel } from "../.."

type Props = ComponentProps<typeof PrototypeCanvasHubPanel>

export function renderPrototypeCanvasHubPanel(
  props: Pick<Props, "status"> & Partial<Props>,
  preview?: ReactNode,
) {
  render(<div id="canvas-review-controls" />)
  const defaults = {
    config: { name: "Example", prototypeUrl: "http://localhost:4321/", token: "local" },
    frameRef: createRef<HTMLIFrameElement>(),
    onStatusChange: async () => {},
    onSelectHub: async () => {},
    onConnect: () => {},
    onClose: () => {},
    open: true,
    ...props,
  }
  function panel(next: Partial<Props>) {
    return (
      <ThemeProvider>
        {preview}
        <PrototypeCanvasHubPanel {...defaults} {...next} />
      </ThemeProvider>
    )
  }
  const view = render(panel({}))
  return { ...view, rerender: (next: Partial<Props>) => view.rerender(panel(next)) }
}
