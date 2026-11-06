import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import "./styles.css"

interface Particle {
  emoji: string
  x: number
  y: number
  velocityX: number
  velocityY: number
  size: number
  startsAt: number
  age: number
  opacity: number
}

export function useEmojiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const bitmapsRef = useRef(new Map<string, HTMLCanvasElement | null>())
  const [active, setActive] = useState(false)

  const burst = useCallback((emoji: string, x: number, y: number) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

    const count = 4 + Math.floor(Math.random() * 5)
    const now = performance.now()
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const speed = 2 + Math.random() * 0.8
      particlesRef.current.push({
        emoji,
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        size: 9 + Math.random() * 8,
        startsAt: now + Math.random() * 120,
        age: 0,
        opacity: 1,
      })
    }
    setActive(true)
  }, [])

  useEffect(() => {
    if (!active) return

    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) {
      console.error("Emoji reaction burst could not create a canvas context.")
      particlesRef.current = []
      const failedFrame = requestAnimationFrame(() => setActive(false))
      return () => cancelAnimationFrame(failedFrame)
    }

    const drawingCanvas = canvas
    const drawingContext = context
    let frame: number
    function resize() {
      const ratio = window.devicePixelRatio || 1
      drawingCanvas.width = Math.round(window.innerWidth * ratio)
      drawingCanvas.height = Math.round(window.innerHeight * ratio)
      drawingContext.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    function bitmapFor(emoji: string, size: number) {
      const roundedSize = Math.round(size)
      const key = `${emoji}_${roundedSize}`
      if (bitmapsRef.current.has(key)) return bitmapsRef.current.get(key) ?? null

      const bitmap = document.createElement("canvas")
      bitmap.width = roundedSize * 2
      bitmap.height = roundedSize * 2
      const bitmapContext = bitmap.getContext("2d")
      if (!bitmapContext) {
        console.error("Emoji reaction burst could not draw an emoji.")
        bitmapsRef.current.set(key, null)
        return null
      }
      bitmapContext.font = `${roundedSize}px serif`
      bitmapContext.textAlign = "center"
      bitmapContext.textBaseline = "middle"
      bitmapContext.fillText(emoji, roundedSize, roundedSize)
      bitmapsRef.current.set(key, bitmap)
      return bitmap
    }

    function draw(timestamp: number) {
      drawingContext.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const remaining: Particle[] = []
      for (const particle of particlesRef.current) {
        if (timestamp < particle.startsAt) {
          remaining.push(particle)
          continue
        }

        particle.x += particle.velocityX
        particle.y += particle.velocityY
        particle.velocityY += 0.09
        particle.velocityX *= 0.97
        particle.age += 1
        if (particle.age > 10) particle.opacity -= 0.04
        if (particle.opacity <= 0) continue

        const bitmap = bitmapFor(particle.emoji, particle.size)
        if (bitmap) {
          drawingContext.globalAlpha = particle.opacity
          drawingContext.drawImage(
            bitmap,
            particle.x - bitmap.width / 2,
            particle.y - bitmap.height / 2,
          )
        }
        remaining.push(particle)
      }
      drawingContext.globalAlpha = 1
      particlesRef.current = remaining
      if (remaining.length > 0) frame = requestAnimationFrame(draw)
      else setActive(false)
    }

    resize()
    window.addEventListener("resize", resize)
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", resize)
    }
  }, [active])

  return {
    burst,
    canvas: active
      ? createPortal(
          <canvas ref={canvasRef} className="review-emoji-burst" aria-hidden="true" />,
          document.body,
        )
      : null,
  }
}
