import { SparkleIcon } from "@primer/octicons-react"
import { Button } from "@primer/react-brand/esm"

import { HubCounter } from "@components/hub-counter"
import { copy } from "./en"

import "./styles.css"

export function PrototypeCanvasFixPill({
  count,
  disabled,
  busy = false,
  onFix,
}: {
  count: number
  disabled?: boolean
  busy?: boolean
  onFix: () => void
}) {
  if (!count) return null

  return (
    <div className="canvas-fix-pill">
      <Button
        size="small"
        variant="primary"
        leadingVisual={<SparkleIcon size={16} />}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={copy.label(count)}
        onClick={onFix}
      >
        {copy.fix}
        <span key={count} className="canvas-fix-pill__count">
          <HubCounter aria-hidden="true">{count}</HubCounter>
        </span>
      </Button>
    </div>
  )
}
