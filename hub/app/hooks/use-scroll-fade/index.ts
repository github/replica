import { useLayoutEffect, useRef } from "react"

export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const viewport = ref.current
    if (!viewport) return

    function update() {
      if (!viewport) return

      const limit = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const position = Math.max(0, Math.min(viewport.scrollTop, limit))
      viewport.toggleAttribute("data-scroll-start", position > 0)
      viewport.toggleAttribute("data-scroll-end", position < limit)
    }

    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    viewport.addEventListener("scroll", update, { passive: true })
    update()

    return () => {
      observer.disconnect()
      viewport.removeEventListener("scroll", update)
    }
  }, [])

  return ref
}
