import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Box, measureElement, useInput, type DOMElement } from "ink"

export function ScrollPanel({
  children,
  height,
  revision,
  feedback,
}: {
  children: ReactNode
  height: number
  revision: number
  feedback: number
}) {
  const content = useRef<DOMElement>(null)
  const [position, setPosition] = useState({ revision, offset: 0 })
  const offset = position.revision === revision ? position.offset : 0
  const setOffset = (update: number | ((value: number) => number)) =>
    setPosition((current) => {
      const previous = current.revision === revision ? current.offset : 0
      const next = typeof update === "number" ? update : update(previous)
      return current.revision === revision && current.offset === next
        ? current
        : { revision, offset: next }
    })
  const [maximum, setMaximum] = useState(0)
  useLayoutEffect(() => {
    if (!content.current) return
    const maximum = Math.max(0, Math.ceil(measureElement(content.current).height) - height)
    setMaximum(maximum)
    setOffset((value) => Math.min(value, maximum))
  })
  useLayoutEffect(() => {
    if (feedback && content.current) {
      setOffset(Math.max(0, Math.ceil(measureElement(content.current).height) - height))
    }
  }, [feedback, height])
  useInput((_input, key) => {
    if (key.pageDown) setOffset((value) => Math.min(maximum, value + Math.max(1, height - 1)))
    if (key.pageUp) setOffset((value) => Math.max(0, value - Math.max(1, height - 1)))
  })
  return (
    <Box height={height} overflowY="hidden" flexDirection="column" flexShrink={0}>
      <Box ref={content} flexDirection="column" flexShrink={0} marginTop={-offset}>
        {children}
      </Box>
    </Box>
  )
}
