"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ─── Constants ───────────────────────────────────────────────────────────────
const WAVE_SPEED = 2.8
const WAVE_SPACING = 38
const WAVE_COUNT = 14
const REFLECTION_OPACITY_DECAY = 0.012

interface Wave {
  x: number
  opacity: number
  reflected: boolean
  reflectedAtX?: number
}

// ─── Draw helpers ────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.75)
  grad.addColorStop(0, "#0c1929")
  grad.addColorStop(1, "#060d17")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // subtle tissue-like texture
  ctx.globalAlpha = 0.025
  for (let i = 0; i < 120; i++) {
    const tx = Math.random() * w
    const ty = Math.random() * h
    const r = Math.random() * 3 + 1
    ctx.beginPath()
    ctx.arc(tx, ty, r, 0, Math.PI * 2)
    ctx.fillStyle = "#4ea8c7"
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawTransducer(ctx: CanvasRenderingContext2D, x: number, h: number) {
  const tw = 28
  const th = h * 0.38

  // body
  const grad = ctx.createLinearGradient(x - tw, 0, x + tw, 0)
  grad.addColorStop(0, "#1e3a5f")
  grad.addColorStop(0.5, "#2d5a8a")
  grad.addColorStop(1, "#1e3a5f")

  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(x - tw, h / 2 - th / 2, tw * 2, th, [6, 6, 6, 6])
  ctx.fill()

  // emitting face glow
  ctx.shadowColor = "#38bdf8"
  ctx.shadowBlur = 18
  ctx.fillStyle = "#38bdf8"
  ctx.fillRect(x + tw - 3, h / 2 - th / 2 + 8, 3, th - 16)
  ctx.shadowBlur = 0

  // label
  ctx.fillStyle = "#94cce6"
  ctx.font = "bold 10px system-ui"
  ctx.textAlign = "center"
  ctx.fillText("TX", x, h / 2 + 3)
}

function drawRedBloodCell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  time: number,
  isHit: boolean
) {
  ctx.save()
  ctx.translate(cx, cy)

  // gentle floating motion
  const floatY = Math.sin(time * 0.8) * 4
  const floatRot = Math.sin(time * 0.5) * 0.06
  ctx.translate(0, floatY)
  ctx.rotate(floatRot)

  // glow when hit
  if (isHit) {
    ctx.shadowColor = "#ff4444"
    ctx.shadowBlur = 30
  }

  // biconcave disc shape - side view (classic RBC profile)
  const rOuter = 36
  const indent = 12

  // outer membrane
  const grad = ctx.createRadialGradient(0, 0, rOuter * 0.2, 0, 0, rOuter)
  grad.addColorStop(0, isHit ? "#ff6666" : "#cc3333")
  grad.addColorStop(0.5, isHit ? "#ee4444" : "#aa2222")
  grad.addColorStop(1, isHit ? "#dd3333" : "#881818")

  ctx.fillStyle = grad
  ctx.beginPath()

  // top curve
  ctx.moveTo(-rOuter, 0)
  ctx.bezierCurveTo(-rOuter, -rOuter * 0.7, -rOuter * 0.3, -rOuter * 0.85, 0, -rOuter * 0.75)
  ctx.bezierCurveTo(rOuter * 0.3, -rOuter * 0.85, rOuter, -rOuter * 0.7, rOuter, 0)

  // bottom curve
  ctx.bezierCurveTo(rOuter, rOuter * 0.7, rOuter * 0.3, rOuter * 0.85, 0, rOuter * 0.75)
  ctx.bezierCurveTo(-rOuter * 0.3, rOuter * 0.85, -rOuter, rOuter * 0.7, -rOuter, 0)
  ctx.closePath()
  ctx.fill()

  // biconcave indent (central dimple)
  ctx.fillStyle = isHit ? "rgba(120,20,20,0.5)" : "rgba(80,10,10,0.5)"
  ctx.beginPath()
  ctx.ellipse(0, 0, indent, rOuter * 0.45, 0, 0, Math.PI * 2)
  ctx.fill()

  // specular highlight
  ctx.fillStyle = "rgba(255,255,255,0.12)"
  ctx.beginPath()
  ctx.ellipse(-8, -12, 10, 6, -0.4, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.restore()
}

function drawWavefront(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  h: number,
  opacity: number,
  reflected: boolean
) {
  const waveH = h * 0.35
  ctx.save()
  ctx.globalAlpha = Math.max(0, opacity)

  // arc wavefront
  const color = reflected ? "#ff6b6b" : "#38bdf8"
  const grad = ctx.createLinearGradient(x, cy - waveH / 2, x, cy + waveH / 2)
  grad.addColorStop(0, "transparent")
  grad.addColorStop(0.3, color)
  grad.addColorStop(0.5, color)
  grad.addColorStop(0.7, color)
  grad.addColorStop(1, "transparent")

  ctx.strokeStyle = grad
  ctx.lineWidth = reflected ? 1.8 : 2.2
  ctx.beginPath()

  // curved wavefront
  const curveAmount = reflected ? -14 : 14
  ctx.moveTo(x, cy - waveH / 2)
  ctx.quadraticCurveTo(x + curveAmount, cy, x, cy + waveH / 2)
  ctx.stroke()

  ctx.restore()
}

function drawLabels(ctx: CanvasRenderingContext2D, w: number, h: number, cellX: number) {
  ctx.save()
  ctx.fillStyle = "#5a9ab8"
  ctx.font = "11px system-ui"
  ctx.textAlign = "center"

  // transducer label
  ctx.fillText("Transducer", 56, h / 2 + h * 0.24)

  // RBC label
  ctx.fillStyle = "#c47070"
  ctx.fillText("Red Blood Cell", cellX, h / 2 + 62)

  // arrows for incident waves
  ctx.strokeStyle = "rgba(56,189,248,0.3)"
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(100, h * 0.18)
  ctx.lineTo(w * 0.45, h * 0.18)
  ctx.stroke()

  ctx.fillStyle = "rgba(56,189,248,0.5)"
  ctx.font = "10px system-ui"
  ctx.fillText("Incident Waves", w * 0.28, h * 0.16)

  // arrow for reflected waves
  ctx.strokeStyle = "rgba(255,107,107,0.3)"
  ctx.beginPath()
  ctx.moveTo(w * 0.45, h * 0.84)
  ctx.lineTo(100, h * 0.84)
  ctx.stroke()

  ctx.fillStyle = "rgba(255,107,107,0.5)"
  ctx.fillText("Reflected Echoes", w * 0.28, h * 0.82)

  ctx.setLineDash([])
  ctx.restore()
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function UltrasoundSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const wavesRef = useRef<Wave[]>([])
  const timeRef = useRef(0)
  const [isPaused, setIsPaused] = useState(false)
  const [frequency, setFrequency] = useState(1) // multiplier
  const isPausedRef = useRef(false)
  const frequencyRef = useRef(1)

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    frequencyRef.current = frequency
  }, [frequency])

  const initWaves = useCallback((canvasW: number) => {
    const startX = 85
    const waves: Wave[] = []
    for (let i = 0; i < WAVE_COUNT; i++) {
      waves.push({
        x: startX - i * WAVE_SPACING,
        opacity: 1,
        reflected: false,
      })
    }
    wavesRef.current = waves
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
      initWaves(rect.width)
    }

    resize()
    window.addEventListener("resize", resize)

    const animate = () => {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height

      if (!isPausedRef.current) {
        timeRef.current += 0.016
      }

      const cellX = w * 0.62
      const transducerX = 56
      let isHit = false

      // update waves
      if (!isPausedRef.current) {
        const speed = WAVE_SPEED * frequencyRef.current
        for (const wave of wavesRef.current) {
          if (!wave.reflected) {
            wave.x += speed
            if (wave.x >= cellX - 38) {
              wave.reflected = true
              wave.reflectedAtX = wave.x
              wave.opacity = 0.85
            }
          } else {
            wave.x -= speed * 0.7
            wave.opacity -= REFLECTION_OPACITY_DECAY
          }

          // reset wave when it goes off-screen or fades out
          if (wave.reflected && (wave.x < transducerX - 20 || wave.opacity <= 0)) {
            wave.x = transducerX - WAVE_SPACING * 2
            wave.opacity = 0
            wave.reflected = false
            wave.reflectedAtX = undefined
          }

          // fade in new waves
          if (!wave.reflected && wave.x > transducerX + 30 && wave.opacity < 1) {
            wave.opacity = Math.min(1, wave.opacity + 0.03)
          }
          if (!wave.reflected && wave.x < transducerX + 30) {
            wave.opacity = Math.max(0, (wave.x - (transducerX - WAVE_SPACING * 2)) / (WAVE_SPACING * 2 + 30))
          }
        }

        // check if any wave is near cell
        isHit = wavesRef.current.some(
          (wv) =>
            !wv.reflected && Math.abs(wv.x - cellX) < 50
        )
      }

      // draw
      drawBackground(ctx, w, h)
      drawTransducer(ctx, transducerX, h)
      drawRedBloodCell(ctx, cellX, h / 2, timeRef.current, isHit)

      // draw wavefronts
      for (const wave of wavesRef.current) {
        if (wave.opacity > 0.02) {
          drawWavefront(ctx, wave.x, h / 2, h, wave.opacity, wave.reflected)
        }
      }

      drawLabels(ctx, w, h, cellX)

      // title
      ctx.fillStyle = "#7cb8d4"
      ctx.font = "bold 13px system-ui"
      ctx.textAlign = "left"
      ctx.fillText("Ultrasound Propagation & Reflection", 16, 24)
      ctx.font = "11px system-ui"
      ctx.fillStyle = "#4a7f99"
      ctx.fillText("Red Blood Cell Echo Simulation", 16, 40)

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [initWaves])

  return (
    <div className="flex flex-col items-center gap-6 p-6 min-h-screen bg-background">
      <div className="w-full max-w-4xl">
        <canvas
          ref={canvasRef}
          className="w-full rounded-xl border border-border"
          style={{ height: 420, imageRendering: "auto" }}
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          onClick={() => setIsPaused((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
        >
          {isPaused ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="2" width="4" height="12" rx="1" />
              <rect x="9" y="2" width="4" height="12" rx="1" />
            </svg>
          )}
          {isPaused ? "Play" : "Pause"}
        </button>

        <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary px-4 py-2.5">
          <label htmlFor="freq" className="text-sm text-muted-foreground">
            Frequency
          </label>
          <input
            id="freq"
            type="range"
            min={0.3}
            max={3}
            step={0.1}
            value={frequency}
            onChange={(e) => setFrequency(parseFloat(e.target.value))}
            className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="min-w-[3ch] text-sm font-mono text-foreground">
            {frequency.toFixed(1)}x
          </span>
        </div>

        <button
          onClick={() => {
            const canvas = canvasRef.current
            if (canvas) initWaves(canvas.getBoundingClientRect().width)
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 8a6 6 0 0 1 10.3-4.1M14 8a6 6 0 0 1-10.3 4.1" />
            <path d="M12.3 1v3h-3M3.7 15v-3h3" />
          </svg>
          Reset
        </button>
      </div>

      {/* Info Panel */}
      <div className="grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-3">
        <InfoCard
          title="Incident Pulse"
          color="text-primary"
          description="Ultrasound waves travel through tissue as longitudinal pressure waves at ~1540 m/s."
        />
        <InfoCard
          title="Acoustic Impedance"
          color="text-accent"
          description="When the wave encounters the RBC membrane, an impedance mismatch causes partial reflection."
        />
        <InfoCard
          title="Echo Detection"
          color="text-muted-foreground"
          description="The reflected echoes return to the transducer and are converted into an electrical signal for imaging."
        />
      </div>
    </div>
  )
}

function InfoCard({
  title,
  color,
  description,
}: {
  title: string
  color: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className={`mb-1.5 text-sm font-semibold ${color}`}>{title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}
