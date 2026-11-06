import { useEffect, useRef, useState, type ReactNode } from "react"
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
  const [offset, setOffset] = useState(0)
  const [maximum, setMaximum] = useState(0)
  useEffect(() => {
    setOffset(0)
  }, [revision])
  useEffect(() => {
    if (!content.current) return
    const maximum = Math.max(0, Math.ceil(measureElement(content.current).height) - height)
    setMaximum(maximum)
    setOffset((value) => Math.min(value, maximum))
  })
  useEffect(() => {
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
