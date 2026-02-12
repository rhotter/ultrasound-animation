"use client"

import { useEffect, useRef } from "react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface RBC {
  x: number
  y: number
  rotation: number
  size: number // radius of the cell
  hit: boolean
  hitTime: number
}

interface SphericalEcho {
  cx: number
  cy: number
  radius: number
  opacity: number
  birthTime: number
}

interface PulseWave {
  x: number // leading edge x position
  opacity: number
  active: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WAVE_SPEED = 2.8
const ECHO_SPEED = 2.2
const PROBE_TOP_FRAC = 0.15
const PROBE_BOT_FRAC = 0.85
const TRANSDUCER_X = 56
const TRANSDUCER_WIDTH = 18
const NUM_RBCS = 28
const PULSE_WIDTH = 4 // thickness of the planar wavefront line

export default function UltrasoundSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const stateRef = useRef<{
    rbcs: RBC[]
    echoes: SphericalEcho[]
    pulse: PulseWave
    time: number
    initialized: boolean
    dims: { w: number; h: number }
  }>({
    rbcs: [],
    echoes: [],
    pulse: { x: 0, opacity: 1, active: true },
    time: 0,
    initialized: false,
    dims: { w: 0, h: 0 },
  })

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

      const w = rect.width
      const h = rect.height
      const s = stateRef.current
      s.dims = { w, h }

      initScene(w, h)
    }

    const initScene = (w: number, h: number) => {
      const s = stateRef.current

      // Generate many small RBCs scattered in the field
      const rbcs: RBC[] = []
      const probeTop = h * PROBE_TOP_FRAC
      const probeBot = h * PROBE_BOT_FRAC
      const fieldLeft = TRANSDUCER_X + TRANSDUCER_WIDTH + 80
      const fieldRight = w - 30

      for (let i = 0; i < NUM_RBCS; i++) {
        let x: number, y: number
        let tries = 0
        // ensure no overlap
        do {
          x = fieldLeft + Math.random() * (fieldRight - fieldLeft)
          y = probeTop + Math.random() * (probeBot - probeTop)
          tries++
        } while (
          tries < 100 &&
          rbcs.some(
            (c) => Math.hypot(c.x - x, c.y - y) < 26
          )
        )

        rbcs.push({
          x,
          y,
          rotation: Math.random() * Math.PI * 2,
          size: 5 + Math.random() * 5,
          hit: false,
          hitTime: 0,
        })
      }

      s.rbcs = rbcs
      s.echoes = []
      s.pulse = {
        x: TRANSDUCER_X + TRANSDUCER_WIDTH,
        opacity: 1,
        active: true,
      }
      s.time = 0
      s.initialized = true
    }

    resize()
    window.addEventListener("resize", resize)

    const animate = () => {
      const s = stateRef.current
      if (!s.initialized) {
        animFrameRef.current = requestAnimationFrame(animate)
        return
      }

      const { w, h } = s.dims
      s.time += 0.016

      const probeTop = h * PROBE_TOP_FRAC
      const probeBot = h * PROBE_BOT_FRAC

      // ─── Update pulse ────────────────────────────────────────────
      if (s.pulse.active) {
        s.pulse.x += WAVE_SPEED

        // Check collision with each RBC
        for (const rbc of s.rbcs) {
          if (
            !rbc.hit &&
            s.pulse.x >= rbc.x - rbc.size &&
            rbc.y >= probeTop &&
            rbc.y <= probeBot
          ) {
            rbc.hit = true
            rbc.hitTime = s.time

            // Spawn spherical echo from the cell
            s.echoes.push({
              cx: rbc.x,
              cy: rbc.y,
              radius: rbc.size + 1,
              opacity: 0.85,
              birthTime: s.time,
            })
          }
        }

        // Pulse goes off-screen
        if (s.pulse.x > w + 20) {
          s.pulse.active = false
        }
      }

      // ─── Update echoes ───────────────────────────────────────────
      for (const echo of s.echoes) {
        echo.radius += ECHO_SPEED
        echo.opacity = Math.max(0, 0.85 - (s.time - echo.birthTime) * 0.12)
      }
      s.echoes = s.echoes.filter((e) => e.opacity > 0.01)

      // ─── Draw ────────────────────────────────────────────────────
      // Background
      const bgGrad = ctx.createRadialGradient(
        w * 0.4, h * 0.5, 0,
        w * 0.5, h * 0.5, w * 0.8
      )
      bgGrad.addColorStop(0, "#0c1929")
      bgGrad.addColorStop(1, "#050b13")
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // Subtle grid
      ctx.globalAlpha = 0.025
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

      // ─── Transducer probe ──────────────────────────────────────
      const probeGrad = ctx.createLinearGradient(
        TRANSDUCER_X - TRANSDUCER_WIDTH,
        0,
        TRANSDUCER_X + TRANSDUCER_WIDTH,
        0
      )
      probeGrad.addColorStop(0, "#1a3050")
      probeGrad.addColorStop(0.5, "#2a5580")
      probeGrad.addColorStop(1, "#1a3050")
      ctx.fillStyle = probeGrad
      ctx.beginPath()
      ctx.roundRect(
        TRANSDUCER_X - TRANSDUCER_WIDTH,
        probeTop - 8,
        TRANSDUCER_WIDTH * 2,
        probeBot - probeTop + 16,
        [4, 4, 4, 4]
      )
      ctx.fill()

      // Emitting face
      ctx.shadowColor = "#38bdf8"
      ctx.shadowBlur = 12
      ctx.fillStyle = "#38bdf8"
      ctx.fillRect(
        TRANSDUCER_X + TRANSDUCER_WIDTH - 3,
        probeTop,
        3,
        probeBot - probeTop
      )
      ctx.shadowBlur = 0

      // ─── Spherical echoes (draw behind RBCs) ───────────────────
      for (const echo of s.echoes) {
        ctx.save()
        ctx.globalAlpha = echo.opacity
        ctx.strokeStyle = "#ff6b6b"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(echo.cx, echo.cy, echo.radius, 0, Math.PI * 2)
        ctx.stroke()

        // soft inner ring
        ctx.globalAlpha = echo.opacity * 0.25
        ctx.strokeStyle = "#ffaaaa"
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.arc(echo.cx, echo.cy, echo.radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // ─── RBCs ──────────────────────────────────────────────────
      for (const rbc of s.rbcs) {
        const glowStrength =
          rbc.hit ? Math.max(0, 1 - (s.time - rbc.hitTime) * 1.5) : 0

        ctx.save()
        ctx.translate(rbc.x, rbc.y)
        ctx.rotate(rbc.rotation)

        if (glowStrength > 0) {
          ctx.shadowColor = "#ff4444"
          ctx.shadowBlur = 12 * glowStrength
        }

        const r = rbc.size
        // Biconcave disc (elliptical body with dimple)
        const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r)
        const isGlowing = glowStrength > 0.1
        grad.addColorStop(0, isGlowing ? "#ff6666" : "#cc3333")
        grad.addColorStop(0.6, isGlowing ? "#ee3333" : "#aa2222")
        grad.addColorStop(1, isGlowing ? "#cc2222" : "#771515")

        ctx.fillStyle = grad
        ctx.beginPath()
        // Simple biconcave shape
        ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2)
        ctx.fill()

        // Central dimple
        ctx.fillStyle = isGlowing
          ? "rgba(100,15,15,0.5)"
          : "rgba(60,8,8,0.5)"
        ctx.beginPath()
        ctx.ellipse(0, 0, r * 0.35, r * 0.25, 0, 0, Math.PI * 2)
        ctx.fill()

        // Specular highlight
        ctx.fillStyle = "rgba(255,255,255,0.08)"
        ctx.beginPath()
        ctx.ellipse(-r * 0.2, -r * 0.15, r * 0.3, r * 0.15, -0.3, 0, Math.PI * 2)
        ctx.fill()

        ctx.shadowBlur = 0
        ctx.restore()
      }

      // ─── Incident pulse wavefront ─────────────────────────────
      if (s.pulse.active && s.pulse.x > TRANSDUCER_X + TRANSDUCER_WIDTH) {
        ctx.save()
        ctx.globalAlpha = s.pulse.opacity

        // The wavefront is a vertical line spanning the full probe width
        const wfGrad = ctx.createLinearGradient(
          s.pulse.x, probeTop,
          s.pulse.x, probeBot
        )
        wfGrad.addColorStop(0, "rgba(56,189,248,0)")
        wfGrad.addColorStop(0.08, "rgba(56,189,248,0.9)")
        wfGrad.addColorStop(0.5, "rgba(56,189,248,1)")
        wfGrad.addColorStop(0.92, "rgba(56,189,248,0.9)")
        wfGrad.addColorStop(1, "rgba(56,189,248,0)")

        // Glow behind
        ctx.shadowColor = "#38bdf8"
        ctx.shadowBlur = 10
        ctx.strokeStyle = wfGrad
        ctx.lineWidth = PULSE_WIDTH
        ctx.beginPath()
        ctx.moveTo(s.pulse.x, probeTop)
        ctx.lineTo(s.pulse.x, probeBot)
        ctx.stroke()

        // Bright core
        ctx.shadowBlur = 0
        ctx.lineWidth = 1.5
        ctx.strokeStyle = wfGrad
        ctx.beginPath()
        ctx.moveTo(s.pulse.x, probeTop)
        ctx.lineTo(s.pulse.x, probeBot)
        ctx.stroke()

        ctx.restore()
      }

      // ─── Auto-restart after everything fades ───────────────────
      const allDone =
        !s.pulse.active &&
        s.echoes.length === 0

      if (allDone) {
        // Reset after a short pause
        setTimeout(() => {
          const { w: cw, h: ch } = stateRef.current.dims
          const pt = ch * PROBE_TOP_FRAC
          const pb = ch * PROBE_BOT_FRAC

          // Reset RBCs
          for (const rbc of s.rbcs) {
            rbc.hit = false
            rbc.hitTime = 0
          }
          s.echoes = []
          s.pulse = {
            x: TRANSDUCER_X + TRANSDUCER_WIDTH,
            opacity: 1,
            active: true,
          }
        }, 1200)
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <canvas
        ref={canvasRef}
        className="w-full max-w-5xl rounded-xl border border-border"
        style={{ height: 520, imageRendering: "auto" }}
        role="img"
        aria-label="2D animation of a single ultrasound pulse propagating from a transducer and producing spherical echoes upon reflecting off multiple red blood cells"
      />
    </div>
  )
}
