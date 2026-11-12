import { PlayIcon, StopIcon } from "@primer/octicons-react"
import type { CSSProperties } from "react"
import { useEffect, useMemo, useRef, useState } from "react"

import { HubIconButton } from "@components/hub-icon-button"

import "./styles.css"

const FIELD_WIDTH = 1536
const FIELD_HEIGHT = 1024
const FIELD_RENDER_WIDTH = FIELD_WIDTH + 32
const CELL_SIZE = 8
const DENSITY_WIDTH = 0.44
const COLOR_MIX_DELAY = 0.025
const COLOR_MIX_WIDTH = 0.075
const INTERACTION_START = FIELD_WIDTH * 0.5
const PALETTE_HOLD_SECONDS = 12
const PALETTE_TRANSITION_SECONDS = 3
const PALETTE_WIPE_WIDTH = 0.08

function fieldState(horizontal: number, vertical: number, phase: number) {
  const edge =
    0.4 +
    Math.sin(phase * 0.35) * 0.025 -
    vertical * 0.03 +
    Math.sin(vertical * Math.PI * 2 + 0.4 + phase * 0.22) * 0.04 +
    Math.sin(vertical * Math.PI * 5 + 0.7 - phase * 0.31) * 0.02
  const progress = Math.max(0, Math.min(1, (horizontal - edge) / DENSITY_WIDTH))

  return {
    density: progress * progress * (3 - 2 * progress),
    edge,
    progress,
  }
}

function highlightChance(horizontal: number, edge: number) {
  const colorStart = edge + DENSITY_WIDTH + COLOR_MIX_DELAY
  const mix = Math.max(0, Math.min(1, (horizontal - colorStart) / COLOR_MIX_WIDTH))

  return mix * mix * (3 - 2 * mix)
}

function paletteState(phase: number, paletteCount: number) {
  if (paletteCount < 2) return { currentIndex: 0, nextIndex: 0, transition: 0 }

  const segmentDuration = PALETTE_HOLD_SECONDS + PALETTE_TRANSITION_SECONDS
  const segment = Math.floor(phase / segmentDuration) % paletteCount
  const segmentTime = phase % segmentDuration
  const transitionProgress = Math.max(
    0,
    Math.min(1, (segmentTime - PALETTE_HOLD_SECONDS) / PALETTE_TRANSITION_SECONDS),
  )

  return {
    currentIndex: segment,
    nextIndex: (segment + 1) % paletteCount,
    transition: transitionProgress ** 2 * (3 - 2 * transitionProgress),
  }
}

function paletteChance(horizontal: number, vertical: number, transition: number) {
  if (transition <= 0) return 0
  if (transition >= 1) return 1

  const curve = (vertical - 0.5) * 0.035 + Math.sin(vertical * Math.PI * 2 + 0.5) * 0.035
  const front = 1.08 - transition * 1.16 + curve
  const mix = Math.max(0, Math.min(1, (horizontal - front) / PALETTE_WIPE_WIDTH))

  return mix * mix * (3 - 2 * mix)
}

type ColorPalette = {
  highlightColor: string
  pixelColor: string
}

type Props = {
  backgroundColor?: string
  className?: string
  controlBorderColor?: string
  controlColor?: string
  highlightColor?: string
  palettes?: readonly ColorPalette[]
  pauseLabel: string
  pixelColor?: string
  resumeLabel: string
  onPauseChange?: (paused: boolean) => void
}

export function AsciiGradient({
  backgroundColor = "#000000",
  className,
  controlBorderColor,
  controlColor = "#FFFFFF",
  highlightColor = "#47B966",
  palettes,
  pauseLabel,
  pixelColor = "#258B48",
  resumeLabel,
  onPauseChange,
}: Props) {
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const updatePlaybackRef = useRef<(() => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteSequence = useMemo(
    () => (palettes?.length ? palettes : [{ highlightColor, pixelColor }]),
    [highlightColor, palettes, pixelColor],
  )
  const field = useMemo(() => {
    const primary: string[] = []
    const highlights: string[] = []
    const cells: {
      x: number
      y: number
      horizontal: number
      vertical: number
      threshold: number
      colorThreshold: number
      paletteThreshold: number
      square: string
    }[] = []

    for (let y = 0; y < FIELD_HEIGHT; y += CELL_SIZE) {
      for (let x = 0; x < FIELD_RENDER_WIDTH; x += CELL_SIZE) {
        const horizontal = x / FIELD_WIDTH
        const vertical = y / FIELD_HEIGHT
        // Interleave reversed coordinate bits to generate the exact 8×8 Bayer rank.
        let rank = 0
        for (let bit = 0; bit < 3; bit++) {
          const columnBit = ((x / CELL_SIZE) >> bit) & 1
          const rowBit = ((y / CELL_SIZE) >> bit) & 1
          rank = rank * 4 + 2 * (columnBit ^ rowBit) + columnBit
        }
        const threshold = (rank + 0.5) / 64
        let colorRank = 0
        for (let bit = 0; bit < 3; bit++) {
          const columnBit = ((x / CELL_SIZE + 3) >> bit) & 1
          const rowBit = ((y / CELL_SIZE + 5) >> bit) & 1
          colorRank = colorRank * 4 + 2 * (columnBit ^ rowBit) + columnBit
        }
        const colorThreshold = (colorRank + 0.5) / 64
        let paletteRank = 0
        for (let bit = 0; bit < 3; bit++) {
          const columnBit = ((x / CELL_SIZE + 6) >> bit) & 1
          const rowBit = ((y / CELL_SIZE + 1) >> bit) & 1
          paletteRank = paletteRank * 4 + 2 * (columnBit ^ rowBit) + columnBit
        }
        const paletteThreshold = (paletteRank + 0.5) / 64
        const square = `M${x} ${y}h${CELL_SIZE}v${CELL_SIZE}h-${CELL_SIZE}z`
        const state = fieldState(horizontal, vertical, 0)

        cells.push({
          x,
          y,
          horizontal,
          vertical,
          threshold,
          colorThreshold,
          paletteThreshold,
          square,
        })
        if (state.density <= threshold) continue

        if (highlightChance(horizontal, state.edge) > colorThreshold) {
          highlights.push(square)
        } else {
          primary.push(square)
        }
      }
    }

    return { primary: primary.join(""), highlights: highlights.join(""), cells }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const context = canvas.getContext("2d")
    if (!context) return
    const drawingContext = context

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const hoverPointer = window.matchMedia("(hover: hover) and (pointer: fine)")
    const pixelBuckets = Array.from({ length: 4 }, () => new Uint32Array(field.cells.length))
    const pixelCounts = new Uint32Array(4)
    let frame: number | null = null
    let previousTime: number | null = null
    let previousDrawTime: number | null = null
    let enabled = false
    let phase = 0
    let x = FIELD_WIDTH * 0.56
    let y = FIELD_HEIGHT / 2
    let strength = 0
    let velocityX = 0
    let velocityY = 0
    let velocityStrength = 0
    let pointerX = x
    let pointerY = y
    let influence = 0
    let velocityInfluence = 0
    let targetInfluence = 0

    function draw() {
      pixelCounts.fill(0)
      const radius = 520 + Math.sin((phase * Math.PI * 2) / 18) * 42
      const palette = paletteState(phase, paletteSequence.length)
      const currentColors = paletteSequence[palette.currentIndex]!
      const nextColors = paletteSequence[palette.nextIndex]!

      for (let index = 0; index < field.cells.length; index++) {
        const cell = field.cells[index]!
        const state = fieldState(cell.horizontal, cell.vertical, phase)
        let density = state.density
        const dx = cell.x - x
        const dy = cell.y - y
        const distance = (dx * dx + dy * dy) / (radius * radius)
        const leftFade = Math.max(0, Math.min(1, (cell.x - INTERACTION_START) / 120))

        if (distance < 1 && leftFade > 0 && strength > 0) {
          const falloff = (1 - distance) ** 3 * leftFade
          const bend = Math.sin(dx / 140 + dy / 200 + phase / 4) * 0.16
          density += strength * falloff * ((0.5 - density) * 0.85 + bend)
        }

        if (density <= cell.threshold) continue

        const useNextPalette =
          paletteChance(cell.horizontal, cell.vertical, palette.transition) > cell.paletteThreshold
        const highlighted = highlightChance(cell.horizontal, state.edge) > cell.colorThreshold
        const bucketIndex = (useNextPalette ? 2 : 0) + (highlighted ? 1 : 0)
        pixelBuckets[bucketIndex]![pixelCounts[bucketIndex]!] = index
        pixelCounts[bucketIndex]!++
      }

      drawingContext.clearRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT)
      drawingContext.fillStyle = backgroundColor
      drawingContext.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT)

      const colors = [
        currentColors.pixelColor,
        currentColors.highlightColor,
        nextColors.pixelColor,
        nextColors.highlightColor,
      ]
      for (let bucketIndex = 0; bucketIndex < pixelBuckets.length; bucketIndex++) {
        const count = pixelCounts[bucketIndex]!
        if (!count) continue

        const bucket = pixelBuckets[bucketIndex]!
        drawingContext.beginPath()
        for (let pixelIndex = 0; pixelIndex < count; pixelIndex++) {
          const cell = field.cells[bucket[pixelIndex]!]!
          drawingContext.rect(cell.x, cell.y, CELL_SIZE, CELL_SIZE)
        }
        drawingContext.fillStyle = colors[bucketIndex]!
        drawingContext.fill()
      }
    }

    function stop(reset = false) {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = null
      previousTime = previousDrawTime = null
      if (reset) {
        phase = 0
        strength = influence = targetInfluence = 0
        velocityX = velocityY = velocityStrength = velocityInfluence = 0
        draw()
      }
    }

    function updateAvailability() {
      enabled = !reducedMotion.matches && !document.hidden && !pausedRef.current
      if (!hoverPointer.matches) targetInfluence = 0
      if (enabled) {
        start()
        return
      }

      stop(reducedMotion.matches)
    }

    function animate(time: number) {
      frame = null
      if (!enabled || reducedMotion.matches) {
        stop(reducedMotion.matches)
        return
      }

      const elapsed = previousTime === null ? 1 / 60 : Math.max(0, time - previousTime) / 1000
      const springElapsed = Math.min(elapsed, 0.032)
      previousTime = time
      phase += elapsed

      velocityInfluence +=
        ((targetInfluence - influence) * 100 - velocityInfluence * 10) * springElapsed
      influence = Math.max(0, Math.min(1, influence + velocityInfluence * springElapsed))
      const roamX = FIELD_WIDTH * 0.56 + Math.sin((phase * Math.PI * 2) / 24) * 240
      const roamY = FIELD_HEIGHT / 2 + Math.sin((phase * Math.PI * 2) / 31 + 0.65) * 220
      const targetX = roamX + (pointerX - roamX) * influence * 0.55
      const targetY = roamY + (pointerY - roamY) * influence * 0.55
      const targetStrength = 0.78 + Math.sin((phase * Math.PI * 2) / 20) * 0.1 + influence * 0.12

      // Clamp spring integration after stalled frames without slowing the palette clock.
      velocityX += ((targetX - x) * 100 - velocityX * 10) * springElapsed
      velocityY += ((targetY - y) * 100 - velocityY * 10) * springElapsed
      velocityStrength +=
        ((targetStrength - strength) * 100 - velocityStrength * 10) * springElapsed
      x = Math.max(0, Math.min(FIELD_WIDTH, x + velocityX * springElapsed))
      y = Math.max(0, Math.min(FIELD_HEIGHT, y + velocityY * springElapsed))
      strength = Math.max(0, Math.min(1, strength + velocityStrength * springElapsed))

      if (previousDrawTime === null || time - previousDrawTime >= 1000 / 30) {
        draw()
        previousDrawTime = time
      }

      frame = window.requestAnimationFrame(animate)
    }

    function start() {
      if (frame === null) frame = window.requestAnimationFrame(animate)
    }

    function followPointer(event: PointerEvent) {
      if (!enabled || !hoverPointer.matches || event.pointerType !== "mouse") return

      const bounds = container!.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return

      // Map pointer coordinates through the SVG's centered, cover-sized crop.
      const scale = Math.max(bounds.width / FIELD_WIDTH, bounds.height / FIELD_HEIGHT)
      pointerX = Math.max(
        0,
        Math.min(
          FIELD_WIDTH,
          (event.clientX - bounds.left - bounds.width / 2) / scale + FIELD_WIDTH / 2,
        ),
      )
      pointerY = Math.max(
        0,
        Math.min(
          FIELD_HEIGHT,
          (event.clientY - bounds.top - bounds.height / 2) / scale + FIELD_HEIGHT / 2,
        ),
      )
      targetInfluence = 1
    }

    function releasePointer() {
      targetInfluence = 0
    }

    updatePlaybackRef.current = updateAvailability
    updateAvailability()
    if (pausedRef.current && !reducedMotion.matches) draw()
    reducedMotion.addEventListener("change", updateAvailability)
    hoverPointer.addEventListener("change", updateAvailability)
    document.addEventListener("visibilitychange", updateAvailability)
    container.addEventListener("pointermove", followPointer, { passive: true })
    container.addEventListener("pointerleave", releasePointer)
    container.addEventListener("pointercancel", releasePointer)

    return () => {
      updatePlaybackRef.current = null
      stop()
      reducedMotion.removeEventListener("change", updateAvailability)
      hoverPointer.removeEventListener("change", updateAvailability)
      document.removeEventListener("visibilitychange", updateAvailability)
      container.removeEventListener("pointermove", followPointer)
      container.removeEventListener("pointerleave", releasePointer)
      container.removeEventListener("pointercancel", releasePointer)
    }
  }, [backgroundColor, field, paletteSequence])

  return (
    <div
      ref={containerRef}
      className={`ascii-gradient${paused ? " ascii-gradient--paused" : ""}${className ? ` ${className}` : ""}`}
      style={
        {
          "--ascii-gradient-background": backgroundColor,
          "--ascii-gradient-control": controlColor,
          "--ascii-gradient-control-border": controlBorderColor ?? pixelColor,
          "--ascii-gradient-highlight": highlightColor,
        } as CSSProperties
      }
    >
      <svg
        className="ascii-gradient__pixels"
        viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        <rect width={FIELD_WIDTH} height={FIELD_HEIGHT} fill={backgroundColor} />
        <g className="ascii-gradient__field">
          <path
            className="ascii-gradient__base ascii-gradient__palette-current"
            d={field.primary}
            fill={paletteSequence[0]!.pixelColor}
          />
          <path
            className="ascii-gradient__highlights ascii-gradient__palette-current"
            d={field.highlights}
            fill={paletteSequence[0]!.highlightColor}
          />
        </g>
      </svg>
      <svg
        className="ascii-gradient__pixels ascii-gradient__animation"
        viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <foreignObject width={FIELD_WIDTH} height={FIELD_HEIGHT}>
          <canvas
            ref={canvasRef}
            className="ascii-gradient__canvas"
            width={FIELD_WIDTH}
            height={FIELD_HEIGHT}
          />
        </foreignObject>
      </svg>

      <HubIconButton
        icon={paused ? PlayIcon : StopIcon}
        aria-label={paused ? resumeLabel : pauseLabel}
        className="ascii-gradient__playback"
        onClick={() => {
          pausedRef.current = !pausedRef.current
          setPaused(pausedRef.current)
          onPauseChange?.(pausedRef.current)
          updatePlaybackRef.current?.()
        }}
      />
    </div>
  )
}
