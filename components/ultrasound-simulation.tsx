"use client"

import { useEffect, useRef, useCallback } from "react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vessel {
  points: { x: number; y: number }[]
  radius: number // half-width of vessel lumen
}

interface RBC {
  vesselIdx: number
  t: number // 0-1 position along vessel path
  speed: number
  size: number
  rotation: number
  rotSpeed: number
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
  x: number
  opacity: number
  active: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WAVE_SPEED = 2.4
const ECHO_SPEED = 1.8
const PROBE_TOP_FRAC = 0.08
const PROBE_BOT_FRAC = 0.92
const TRANSDUCER_X = 40
const TRANSDUCER_WIDTH = 14
const PULSE_WIDTH = 3
const NUM_RBCS = 14
const RESTART_DELAY = 1800

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function getVesselPoint(
  vessel: Vessel,
  t: number
): { x: number; y: number; angle: number } {
  const pts = vessel.points
  const total = pts.length - 1
  const idx = Math.min(Math.floor(t * total), total - 1)
  const frac = t * total - idx
  const p0 = pts[idx]
  const p1 = pts[Math.min(idx + 1, pts.length - 1)]
  return {
    x: lerp(p0.x, p1.x, frac),
    y: lerp(p0.y, p1.y, frac),
    angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
  }
}

export default function UltrasoundSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const stateRef = useRef<{
    vessels: Vessel[]
    rbcs: RBC[]
    echoes: SphericalEcho[]
    pulse: PulseWave
    time: number
    initialized: boolean
    dims: { w: number; h: number }
    restartTimer: number | null
  }>({
    vessels: [],
    rbcs: [],
    echoes: [],
    pulse: { x: 0, opacity: 1, active: true },
    time: 0,
    initialized: false,
    dims: { w: 0, h: 0 },
    restartTimer: null,
  })

  const buildVessels = useCallback((w: number, h: number): Vessel[] => {
    // Create several organic, curving vessels across the field
    const vessels: Vessel[] = []

    // Large horizontal vessel (artery-like) through middle
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.48
      for (let i = 0; i <= 40; i++) {
        const frac = i / 40
        const x = frac * w
        const y =
          cy +
          Math.sin(frac * Math.PI * 2.5) * h * 0.04 +
          Math.sin(frac * Math.PI * 5) * h * 0.015
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.045 })
    }

    // Upper smaller vessel (curving down)
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.2
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = frac * w
        const y =
          cy +
          Math.sin(frac * Math.PI * 1.8 + 0.5) * h * 0.06 +
          Math.cos(frac * Math.PI * 4) * h * 0.01
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.028 })
    }

    // Lower vessel
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.76
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = frac * w
        const y =
          cy +
          Math.sin(frac * Math.PI * 2 + 1) * h * 0.05 +
          Math.sin(frac * Math.PI * 3.5) * h * 0.012
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.032 })
    }

    // Branching capillary (diagonal upper-right)
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 25; i++) {
        const frac = i / 25
        const x = w * 0.35 + frac * w * 0.55
        const y =
          h * 0.38 -
          frac * h * 0.22 +
          Math.sin(frac * Math.PI * 3) * h * 0.02
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.018 })
    }

    // Branching capillary (diagonal lower-right)
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 25; i++) {
        const frac = i / 25
        const x = w * 0.4 + frac * w * 0.5
        const y =
          h * 0.56 +
          frac * h * 0.18 +
          Math.sin(frac * Math.PI * 2.5 + 1) * h * 0.02
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.02 })
    }

    return vessels
  }, [])

  const buildRBCs = useCallback(
    (vessels: Vessel[]): RBC[] => {
      const rbcs: RBC[] = []
      // Distribute RBCs across vessels, more in larger ones
      const distribution = [4, 3, 3, 2, 2] // per vessel
      for (let vi = 0; vi < vessels.length; vi++) {
        const count = distribution[vi] || 2
        for (let i = 0; i < count; i++) {
          rbcs.push({
            vesselIdx: vi,
            t: Math.random(),
            speed: 0.0003 + Math.random() * 0.0004,
            size: 3 + Math.random() * 2.5,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.02,
            hit: false,
            hitTime: 0,
          })
        }
      }
      return rbcs
    },
    []
  )

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

      s.vessels = buildVessels(w, h)
      s.rbcs = buildRBCs(s.vessels)
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

    const restartPulse = () => {
      const s = stateRef.current
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
      s.restartTimer = null
    }

    const animate = () => {
      const s = stateRef.current
      if (!s.initialized) {
        animFrameRef.current = requestAnimationFrame(animate)
        return
      }

      const { w, h } = s.dims
      const dt = 0.016
      s.time += dt

      const probeTop = h * PROBE_TOP_FRAC
      const probeBot = h * PROBE_BOT_FRAC

      // ─── Move RBCs along vessels ─────────────────────────────────
      for (const rbc of s.rbcs) {
        rbc.t += rbc.speed
        if (rbc.t > 1) rbc.t -= 1
        rbc.rotation += rbc.rotSpeed
      }

      // ─── Update pulse ────────────────────────────────────────────
      if (s.pulse.active) {
        s.pulse.x += WAVE_SPEED

        for (const rbc of s.rbcs) {
          if (rbc.hit) continue
          const vessel = s.vessels[rbc.vesselIdx]
          const pos = getVesselPoint(vessel, rbc.t)
          if (
            s.pulse.x >= pos.x - rbc.size &&
            pos.y >= probeTop &&
            pos.y <= probeBot
          ) {
            rbc.hit = true
            rbc.hitTime = s.time
            s.echoes.push({
              cx: pos.x,
              cy: pos.y,
              radius: rbc.size + 1,
              opacity: 0.9,
              birthTime: s.time,
            })
          }
        }

        if (s.pulse.x > w + 20) {
          s.pulse.active = false
        }
      }

      // ─── Update echoes ───────────────────────────────────────────
      for (const echo of s.echoes) {
        echo.radius += ECHO_SPEED
        echo.opacity = Math.max(0, 0.9 - (s.time - echo.birthTime) * 0.1)
      }
      s.echoes = s.echoes.filter((e) => e.opacity > 0.01)

      // ─── Auto-restart ────────────────────────────────────────────
      if (!s.pulse.active && s.echoes.length === 0 && !s.restartTimer) {
        s.restartTimer = window.setTimeout(restartPulse, RESTART_DELAY)
      }

      // ─── DRAW ────────────────────────────────────────────────────
      // Background - dark tissue
      const bgGrad = ctx.createRadialGradient(
        w * 0.45,
        h * 0.5,
        0,
        w * 0.5,
        h * 0.5,
        w * 0.85
      )
      bgGrad.addColorStop(0, "#0f1318")
      bgGrad.addColorStop(0.6, "#0a0e14")
      bgGrad.addColorStop(1, "#060810")
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // Subtle tissue texture (fine dots)
      ctx.globalAlpha = 0.03
      for (let i = 0; i < 200; i++) {
        const tx = ((i * 137.5) % w)
        const ty = ((i * 97.3 + 50) % h)
        ctx.fillStyle = "#5577aa"
        ctx.fillRect(tx, ty, 1, 1)
      }
      ctx.globalAlpha = 1

      // ─── Draw vessels ──────────────────────────────────────────
      for (const vessel of s.vessels) {
        const pts = vessel.points
        const r = vessel.radius

        // Vessel wall (outer)
        ctx.save()
        ctx.lineWidth = r * 2 + 4
        ctx.strokeStyle = "rgba(50,25,30,0.6)"
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y)
        }
        ctx.stroke()

        // Vessel lumen (inner)
        ctx.lineWidth = r * 2
        const lumenGrad = ctx.createLinearGradient(0, 0, w, 0)
        lumenGrad.addColorStop(0, "rgba(40,10,15,0.8)")
        lumenGrad.addColorStop(0.5, "rgba(55,15,20,0.8)")
        lumenGrad.addColorStop(1, "rgba(40,10,15,0.8)")
        ctx.strokeStyle = lumenGrad
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y)
        }
        ctx.stroke()

        // Vessel wall edges (membrane)
        ctx.lineWidth = 1
        ctx.strokeStyle = "rgba(120,50,60,0.35)"
        // Top edge
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const angle =
            i < pts.length - 1
              ? Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
              : Math.atan2(
                  pts[i].y - pts[i - 1].y,
                  pts[i].x - pts[i - 1].x
                )
          const nx = pts[i].x + Math.cos(angle - Math.PI / 2) * r
          const ny = pts[i].y + Math.sin(angle - Math.PI / 2) * r
          if (i === 0) ctx.moveTo(nx, ny)
          else ctx.lineTo(nx, ny)
        }
        ctx.stroke()
        // Bottom edge
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const angle =
            i < pts.length - 1
              ? Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
              : Math.atan2(
                  pts[i].y - pts[i - 1].y,
                  pts[i].x - pts[i - 1].x
                )
          const nx = pts[i].x + Math.cos(angle + Math.PI / 2) * r
          const ny = pts[i].y + Math.sin(angle + Math.PI / 2) * r
          if (i === 0) ctx.moveTo(nx, ny)
          else ctx.lineTo(nx, ny)
        }
        ctx.stroke()
        ctx.restore()
      }

      // ─── Spherical echoes ──────────────────────────────────────
      for (const echo of s.echoes) {
        ctx.save()
        ctx.globalAlpha = echo.opacity * 0.7
        ctx.strokeStyle = "#ff5555"
        ctx.lineWidth = 1.5
        ctx.shadowColor = "#ff3333"
        ctx.shadowBlur = 6
        ctx.beginPath()
        ctx.arc(echo.cx, echo.cy, echo.radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0

        ctx.globalAlpha = echo.opacity * 0.2
        ctx.strokeStyle = "#ffaaaa"
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.arc(echo.cx, echo.cy, echo.radius * 0.95, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // ─── Draw RBCs ────────────────────────────────────────────
      for (const rbc of s.rbcs) {
        const vessel = s.vessels[rbc.vesselIdx]
        const pos = getVesselPoint(vessel, rbc.t)
        const glowStrength = rbc.hit
          ? Math.max(0, 1 - (s.time - rbc.hitTime) * 1.2)
          : 0

        ctx.save()
        ctx.translate(pos.x, pos.y)
        ctx.rotate(pos.angle + rbc.rotation)

        if (glowStrength > 0) {
          ctx.shadowColor = "#ff4444"
          ctx.shadowBlur = 14 * glowStrength
        }

        const r = rbc.size
        const isGlowing = glowStrength > 0.1
        const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r)
        grad.addColorStop(0, isGlowing ? "#ff6666" : "#cc2828")
        grad.addColorStop(0.55, isGlowing ? "#ee3333" : "#a01818")
        grad.addColorStop(1, isGlowing ? "#cc2222" : "#6a0e0e")

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI * 2)
        ctx.fill()

        // Central dimple
        ctx.fillStyle = isGlowing
          ? "rgba(90,12,12,0.5)"
          : "rgba(50,6,6,0.55)"
        ctx.beginPath()
        ctx.ellipse(0, 0, r * 0.32, r * 0.2, 0, 0, Math.PI * 2)
        ctx.fill()

        // Highlight
        ctx.fillStyle = "rgba(255,255,255,0.07)"
        ctx.beginPath()
        ctx.ellipse(
          -r * 0.2,
          -r * 0.12,
          r * 0.28,
          r * 0.12,
          -0.3,
          0,
          Math.PI * 2
        )
        ctx.fill()

        ctx.shadowBlur = 0
        ctx.restore()
      }

      // ─── Incident pulse wavefront ─────────────────────────────
      if (
        s.pulse.active &&
        s.pulse.x > TRANSDUCER_X + TRANSDUCER_WIDTH
      ) {
        ctx.save()
        ctx.globalAlpha = s.pulse.opacity

        const wfGrad = ctx.createLinearGradient(
          s.pulse.x,
          probeTop,
          s.pulse.x,
          probeBot
        )
        wfGrad.addColorStop(0, "rgba(56,189,248,0)")
        wfGrad.addColorStop(0.05, "rgba(56,189,248,0.85)")
        wfGrad.addColorStop(0.5, "rgba(56,189,248,1)")
        wfGrad.addColorStop(0.95, "rgba(56,189,248,0.85)")
        wfGrad.addColorStop(1, "rgba(56,189,248,0)")

        ctx.shadowColor = "#38bdf8"
        ctx.shadowBlur = 14
        ctx.strokeStyle = wfGrad
        ctx.lineWidth = PULSE_WIDTH
        ctx.beginPath()
        ctx.moveTo(s.pulse.x, probeTop)
        ctx.lineTo(s.pulse.x, probeBot)
        ctx.stroke()

        // Bright core
        ctx.shadowBlur = 0
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(s.pulse.x, probeTop)
        ctx.lineTo(s.pulse.x, probeBot)
        ctx.stroke()

        ctx.restore()
      }

      // ─── Transducer probe ──────────────────────────────────────
      // Body
      const probeGrad = ctx.createLinearGradient(
        0,
        0,
        TRANSDUCER_X + TRANSDUCER_WIDTH,
        0
      )
      probeGrad.addColorStop(0, "#1a2535")
      probeGrad.addColorStop(0.6, "#253a50")
      probeGrad.addColorStop(1, "#1a2535")
      ctx.fillStyle = probeGrad
      ctx.beginPath()
      ctx.roundRect(
        0,
        probeTop - 6,
        TRANSDUCER_X + TRANSDUCER_WIDTH,
        probeBot - probeTop + 12,
        [0, 4, 4, 0]
      )
      ctx.fill()

      // Border
      ctx.strokeStyle = "rgba(56,189,248,0.15)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(
        0,
        probeTop - 6,
        TRANSDUCER_X + TRANSDUCER_WIDTH,
        probeBot - probeTop + 12,
        [0, 4, 4, 0]
      )
      ctx.stroke()

      // Emitting face glow
      ctx.shadowColor = "#38bdf8"
      ctx.shadowBlur = 16
      ctx.fillStyle = "#38bdf8"
      ctx.fillRect(
        TRANSDUCER_X + TRANSDUCER_WIDTH - 2,
        probeTop,
        2,
        probeBot - probeTop
      )
      ctx.shadowBlur = 0

      // Element lines on probe face
      ctx.globalAlpha = 0.15
      ctx.strokeStyle = "#38bdf8"
      ctx.lineWidth = 0.5
      const numElements = 24
      for (let i = 0; i < numElements; i++) {
        const ey =
          probeTop + ((probeBot - probeTop) / (numElements + 1)) * (i + 1)
        ctx.beginPath()
        ctx.moveTo(TRANSDUCER_X, ey)
        ctx.lineTo(TRANSDUCER_X + TRANSDUCER_WIDTH - 2, ey)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animFrameRef.current)
      if (stateRef.current.restartTimer) {
        clearTimeout(stateRef.current.restartTimer)
      }
    }
  }, [buildVessels, buildRBCs])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <canvas
        ref={canvasRef}
        className="w-full h-screen"
        style={{ imageRendering: "auto" }}
        role="img"
        aria-label="Animation of ultrasound pulse propagating through blood vessels and producing spherical echoes off red blood cells"
      />
    </div>
  )
}
