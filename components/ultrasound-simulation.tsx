"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ─── Constants ───────────────────────────────────────────────────────────────
const WAVE_SPEED = 2.4
const WAVE_SPACING = 42
const INCIDENT_COUNT = 10
const REFLECTION_SPEED = 2.0

interface IncidentWave {
  x: number
  opacity: number
}

interface ReflectedWave {
  cx: number
  cy: number
  radius: number
  opacity: number
}

// ─── Draw helpers ────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.75)
  grad.addColorStop(0, "#0c1929")
  grad.addColorStop(1, "#060d17")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // subtle grid
  ctx.globalAlpha = 0.03
  ctx.strokeStyle = "#4ea8c7"
  ctx.lineWidth = 0.5
  for (let gx = 0; gx < w; gx += 40) {
    ctx.beginPath()
    ctx.moveTo(gx, 0)
    ctx.lineTo(gx, h)
    ctx.stroke()
  }
  for (let gy = 0; gy < h; gy += 40) {
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(w, gy)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawTransducer(ctx: CanvasRenderingContext2D, x: number, h: number) {
  const tw = 22
  const th = h * 0.36

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
  ctx.shadowBlur = 14
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

  const floatY = Math.sin(time * 0.6) * 3
  const floatRot = Math.sin(time * 0.4) * 0.04
  ctx.translate(0, floatY)
  ctx.rotate(floatRot)

  if (isHit) {
    ctx.shadowColor = "#ff4444"
    ctx.shadowBlur = 35
  }

  const rOuter = 34

  const grad = ctx.createRadialGradient(0, 0, rOuter * 0.15, 0, 0, rOuter)
  grad.addColorStop(0, isHit ? "#ff6666" : "#cc3333")
  grad.addColorStop(0.5, isHit ? "#ee4444" : "#aa2222")
  grad.addColorStop(1, isHit ? "#dd3333" : "#881818")

  ctx.fillStyle = grad
  ctx.beginPath()

  // biconcave disc shape
  ctx.moveTo(-rOuter, 0)
  ctx.bezierCurveTo(-rOuter, -rOuter * 0.7, -rOuter * 0.3, -rOuter * 0.85, 0, -rOuter * 0.75)
  ctx.bezierCurveTo(rOuter * 0.3, -rOuter * 0.85, rOuter, -rOuter * 0.7, rOuter, 0)
  ctx.bezierCurveTo(rOuter, rOuter * 0.7, rOuter * 0.3, rOuter * 0.85, 0, rOuter * 0.75)
  ctx.bezierCurveTo(-rOuter * 0.3, rOuter * 0.85, -rOuter, rOuter * 0.7, -rOuter, 0)
  ctx.closePath()
  ctx.fill()

  // central dimple
  ctx.fillStyle = isHit ? "rgba(120,20,20,0.5)" : "rgba(80,10,10,0.5)"
  ctx.beginPath()
  ctx.ellipse(0, 0, 11, rOuter * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()

  // specular highlight
  ctx.fillStyle = "rgba(255,255,255,0.1)"
  ctx.beginPath()
  ctx.ellipse(-7, -10, 9, 5, -0.4, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.restore()
}

function drawIncidentWave(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  h: number,
  opacity: number
) {
  const waveH = h * 0.34
  ctx.save()
  ctx.globalAlpha = Math.max(0, opacity)

  const grad = ctx.createLinearGradient(x, cy - waveH / 2, x, cy + waveH / 2)
  grad.addColorStop(0, "transparent")
  grad.addColorStop(0.2, "#38bdf8")
  grad.addColorStop(0.5, "#38bdf8")
  grad.addColorStop(0.8, "#38bdf8")
  grad.addColorStop(1, "transparent")

  ctx.strokeStyle = grad
  ctx.lineWidth = 2.2

  ctx.beginPath()
  // slight curvature for incident wavefront
  ctx.moveTo(x, cy - waveH / 2)
  ctx.quadraticCurveTo(x + 10, cy, x, cy + waveH / 2)
  ctx.stroke()

  ctx.restore()
}

function drawReflectedWave(
  ctx: CanvasRenderingContext2D,
  wave: ReflectedWave
) {
  ctx.save()
  ctx.globalAlpha = Math.max(0, wave.opacity)

  ctx.strokeStyle = "#ff6b6b"
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.arc(wave.cx, wave.cy, wave.radius, 0, Math.PI * 2)
  ctx.stroke()

  // inner glow ring
  ctx.globalAlpha = Math.max(0, wave.opacity * 0.3)
  ctx.strokeStyle = "#ff9999"
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.arc(wave.cx, wave.cy, wave.radius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.restore()
}

function drawLabels(ctx: CanvasRenderingContext2D, w: number, h: number, cellX: number) {
  ctx.save()

  // transducer label
  ctx.fillStyle = "#5a9ab8"
  ctx.font = "11px system-ui"
  ctx.textAlign = "center"
  ctx.fillText("Transducer", 50, h / 2 + h * 0.24)

  // RBC label
  ctx.fillStyle = "#c47070"
  ctx.fillText("Red Blood Cell", cellX, h / 2 + 58)

  // incident direction
  ctx.strokeStyle = "rgba(56,189,248,0.3)"
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(90, h * 0.14)
  ctx.lineTo(w * 0.44, h * 0.14)
  ctx.stroke()

  // arrow tip
  ctx.fillStyle = "rgba(56,189,248,0.4)"
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(w * 0.44, h * 0.14)
  ctx.lineTo(w * 0.44 - 6, h * 0.14 - 3)
  ctx.lineTo(w * 0.44 - 6, h * 0.14 + 3)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = "rgba(56,189,248,0.5)"
  ctx.font = "10px system-ui"
  ctx.fillText("Incident Waves", w * 0.27, h * 0.12)

  // reflected direction
  ctx.strokeStyle = "rgba(255,107,107,0.3)"
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(w * 0.44, h * 0.88)
  ctx.lineTo(90, h * 0.88)
  ctx.stroke()

  ctx.fillStyle = "rgba(255,107,107,0.4)"
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(90, h * 0.88)
  ctx.lineTo(96, h * 0.88 - 3)
  ctx.lineTo(96, h * 0.88 + 3)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = "rgba(255,107,107,0.5)"
  ctx.font = "10px system-ui"
  ctx.fillText("Spherical Echoes", w * 0.27, h * 0.86)

  ctx.setLineDash([])
  ctx.restore()
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function UltrasoundSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const incidentRef = useRef<IncidentWave[]>([])
  const reflectedRef = useRef<ReflectedWave[]>([])
  const timeRef = useRef(0)
  const [isPaused, setIsPaused] = useState(false)
  const [frequency, setFrequency] = useState(1)
  const isPausedRef = useRef(false)
  const frequencyRef = useRef(1)

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    frequencyRef.current = frequency
  }, [frequency])

  const initWaves = useCallback(() => {
    const startX = 80
    const waves: IncidentWave[] = []
    for (let i = 0; i < INCIDENT_COUNT; i++) {
      waves.push({
        x: startX - i * WAVE_SPACING,
        opacity: 1,
      })
    }
    incidentRef.current = waves
    reflectedRef.current = []
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
      initWaves()
    }

    resize()
    window.addEventListener("resize", resize)

    const animate = () => {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const cy = h / 2

      if (!isPausedRef.current) {
        timeRef.current += 0.016
      }

      const cellX = w * 0.62
      const cellR = 34
      const transducerFace = 74
      let isHit = false

      if (!isPausedRef.current) {
        const speed = WAVE_SPEED * frequencyRef.current

        // update incident waves
        for (const wave of incidentRef.current) {
          wave.x += speed

          // fade in
          if (wave.x < transducerFace + 30) {
            wave.opacity = Math.max(
              0,
              (wave.x - (transducerFace - WAVE_SPACING * 2)) / (WAVE_SPACING * 2 + 30)
            )
          } else {
            wave.opacity = Math.min(1, wave.opacity + 0.03)
          }

          // hit the cell - spawn spherical reflection
          if (wave.x >= cellX - cellR) {
            // spawn reflection from the cell surface
            const floatY = Math.sin(timeRef.current * 0.6) * 3
            reflectedRef.current.push({
              cx: cellX - cellR + 2,
              cy: cy + floatY,
              radius: 2,
              opacity: 0.9,
            })

            // reset wave to start
            wave.x = transducerFace - WAVE_SPACING * 2
            wave.opacity = 0
            isHit = true
          }
        }

        // update reflected waves (expanding circles)
        const reflSpeed = REFLECTION_SPEED * frequencyRef.current
        for (const rw of reflectedRef.current) {
          rw.radius += reflSpeed * 1.2
          rw.opacity -= 0.005
        }

        // remove faded-out reflections
        reflectedRef.current = reflectedRef.current.filter(
          (rw) => rw.opacity > 0.01 && rw.radius < w
        )

        // check proximity for glow
        if (!isHit) {
          isHit = incidentRef.current.some(
            (wv) => Math.abs(wv.x - (cellX - cellR)) < 20 && wv.opacity > 0.3
          )
        }
      }

      // ─── Draw ──────────────────────────────────────────────────────
      drawBackground(ctx, w, h)
      drawTransducer(ctx, 50, h)

      // reflected waves (behind the cell)
      for (const rw of reflectedRef.current) {
        drawReflectedWave(ctx, rw)
      }

      drawRedBloodCell(ctx, cellX, cy, timeRef.current, isHit)

      // incident wavefronts
      for (const wave of incidentRef.current) {
        if (wave.opacity > 0.02) {
          drawIncidentWave(ctx, wave.x, cy, h, wave.opacity)
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
      ctx.fillText("2D Spherical Echo Simulation", 16, 40)

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
          style={{ height: 440, imageRendering: "auto" }}
          role="img"
          aria-label="2D animation of ultrasound waves propagating from a transducer and reflecting as spherical echoes off a red blood cell"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          onClick={() => setIsPaused((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
        >
          {isPaused ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
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
          onClick={initWaves}
          className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
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
          description="Planar ultrasound wavefronts travel through tissue as longitudinal pressure waves at ~1540 m/s."
        />
        <InfoCard
          title="Spherical Reflection"
          color="text-accent"
          description="When the wave strikes the RBC, the impedance mismatch causes spherical echoes to radiate outward from the scattering point."
        />
        <InfoCard
          title="Echo Detection"
          color="text-muted-foreground"
          description="The expanding spherical echoes propagate in all directions; the fraction reaching the transducer is recorded for imaging."
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
