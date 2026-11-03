import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { ControlsConnection, type PanelState } from "@utils/prototype-controls-connection"
import { urlControlsStorage } from "@utils/prototype-controls-url/storage"

type Props = {
  frameRef: RefObject<HTMLIFrameElement | null>
  prototypeUrl: string
  previewUrl?: string
  address: string
  replaceAddress: (address: string) => void
}

/** Gives each preview frame its own controls connection and releases it on replacement. */
export function useControlsConnection({
  frameRef,
  prototypeUrl,
  previewUrl,
  address,
  replaceAddress,
}: Props) {
  const [connection, setConnection] = useState<ControlsConnection | null>(null)
  const [state, setState] = useState<PanelState | null>(null)
  const current = useRef({ address, replaceAddress })
  useLayoutEffect(() => {
    current.current = { address, replaceAddress }
  }, [address, replaceAddress])

  useEffect(() => {
    if (!frameRef.current) return

    const next = new ControlsConnection(
      frameRef.current,
      new URL(previewUrl ?? prototypeUrl).origin,
      urlControlsStorage(
        `prototype:${new URL(prototypeUrl).origin}`,
        () => current.current.address,
        (next) => {
          current.current.address = next
          current.current.replaceAddress(next)
        },
      ),
    )
    setConnection(next)
    const release = next.subscribe(() => setState(next.getSnapshot()))
    next.start()
    return () => {
      release()
      next.stop()
    }
  }, [prototypeUrl, previewUrl, frameRef])

  return { connection, state }
}
