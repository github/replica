import { useEffect, useRef } from "react"

import { ScreenshotImage } from "@components/screenshot-image"

import "./styles.css"

const SCROLL_SPEED_PX_PER_SECOND = 80
const SCROLL_RAMP_SECONDS = 1

/** Shows the top of a screenshot, then reveals the rest when the preview is hovered. */
export function ScrollingScreenshot({
  alt,
  className,
  src,
  darkSrc,
}: {
  alt: string
  className?: string
  src: string
  darkSrc?: string
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const preview = previewRef.current
    const image = imageRef.current
    if (!preview || !image) return

    function updateMotion() {
      if (!preview || !image || !image.naturalWidth || !image.naturalHeight) return

      const renderedHeight = (image.clientWidth / image.naturalWidth) * image.naturalHeight
      const distance = Math.max(0, renderedHeight - preview.clientHeight)
      preview.toggleAttribute("data-fits", distance === 0)
      const rampDuration = Math.min(
        SCROLL_RAMP_SECONDS,
        Math.sqrt((2 * distance * SCROLL_RAMP_SECONDS) / SCROLL_SPEED_PX_PER_SECOND),
      )
      const rampDistance = Math.min(
        distance,
        (SCROLL_SPEED_PX_PER_SECOND * rampDuration ** 2) / (2 * SCROLL_RAMP_SECONDS),
      )

      preview.style.setProperty("--scrolling-screenshot-ramp-offset", `${-rampDistance}px`)
      preview.style.setProperty(
        "--scrolling-screenshot-linear-offset",
        `${rampDistance - distance}px`,
      )
      preview.style.setProperty("--scrolling-screenshot-ramp-duration", `${rampDuration}s`)
      preview.style.setProperty(
        "--scrolling-screenshot-linear-duration",
        `${(distance - rampDistance) / SCROLL_SPEED_PX_PER_SECOND}s`,
      )
    }

    const resizeObserver = new ResizeObserver(updateMotion)
    resizeObserver.observe(preview)
    image.addEventListener("load", updateMotion)
    updateMotion()

    return () => {
      resizeObserver.disconnect()
      image.removeEventListener("load", updateMotion)
    }
  }, [src, darkSrc])

  return (
    <div
      ref={previewRef}
      className={["scrolling-screenshot", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={alt}
      tabIndex={0}
    >
      <div className="scrolling-screenshot__motion">
        <ScreenshotImage ref={imageRef} src={src} darkSrc={darkSrc} alt={alt} loading="lazy" />
      </div>
    </div>
  )
}
