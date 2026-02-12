"use client"

import { useEffect, useRef, useCallback } from "react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vessel {
  points: { x: number; y: number }[]
  radius: number
}

interface RBC {
  vesselIdx: number
  t: number
  speed: number
  size: number
  rotation: number
  rotSpeed: number
  hit: boolean
  hitTime: number
  labeled: boolean
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
const PROBE_FACE_X = 60
const PROBE_HOUSING_WIDTH = 32
const PROBE_BODY_WIDTH = 46
const PULSE_WIDTH = 3
const NUM_ELEMENTS = 32
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
    const vessels: Vessel[] = []
    const margin = 20 // keep vessels away from edges
    const probeTop = h * PROBE_TOP_FRAC
    const probeBot = h * PROBE_BOT_FRAC

    // Clamp points to stay within the beam field of view
    const clampY = (y: number) => Math.max(probeTop + margin, Math.min(probeBot - margin, y))

    // Large horizontal vessel (artery) - stays in middle
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.48
      for (let i = 0; i <= 40; i++) {
        const frac = i / 40
        const x = PROBE_FACE_X + 20 + frac * (w - PROBE_FACE_X - 40)
        const y = clampY(
          cy +
          Math.sin(frac * Math.PI * 2.5) * h * 0.04 +
          Math.sin(frac * Math.PI * 5) * h * 0.015
        )
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.045 })
    }

    // Upper smaller vessel
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.25
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = PROBE_FACE_X + 20 + frac * (w - PROBE_FACE_X - 40)
        const y = clampY(
          cy +
          Math.sin(frac * Math.PI * 1.8 + 0.5) * h * 0.04 +
          Math.cos(frac * Math.PI * 4) * h * 0.01
        )
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.028 })
    }

    // Lower vessel
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.72
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = PROBE_FACE_X + 20 + frac * (w - PROBE_FACE_X - 40)
        const y = clampY(
          cy +
          Math.sin(frac * Math.PI * 2 + 1) * h * 0.04 +
          Math.sin(frac * Math.PI * 3.5) * h * 0.012
        )
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.032 })
    }

    // Branching capillary (diagonal upper)
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 25; i++) {
        const frac = i / 25
        const x = PROBE_FACE_X + 20 + w * 0.2 + frac * (w * 0.5)
        const y = clampY(
          h * 0.42 -
          frac * h * 0.15 +
          Math.sin(frac * Math.PI * 3) * h * 0.02
        )
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.018 })
    }

    // Branching capillary (diagonal lower)
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 25; i++) {
        const frac = i / 25
        const x = PROBE_FACE_X + 20 + w * 0.25 + frac * (w * 0.45)
        const y = clampY(
          h * 0.55 +
          frac * h * 0.12 +
          Math.sin(frac * Math.PI * 2.5 + 1) * h * 0.02
        )
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.02 })
    }

    return vessels
  }, [])

  const buildRBCs = useCallback((): RBC[] => {
    const rbcs: RBC[] = []
    const distribution = [4, 3, 3, 2, 2]
    let firstLabeled = false
    for (let vi = 0; vi < 5; vi++) {
      const count = distribution[vi] || 2
      for (let i = 0; i < count; i++) {
        const labeled = !firstLabeled && vi === 0 && i === 1
        if (labeled) firstLabeled = true
        rbcs.push({
          vesselIdx: vi,
          t: 0.35 + Math.random() * 0.6,
          speed: 0.0003 + Math.random() * 0.0004,
          size: 3 + Math.random() * 2.5,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.02,
          hit: false,
          hitTime: 0,
          labeled,
        })
      }
    }
    return rbcs
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

      const w = rect.width
      const h = rect.height
      const s = stateRef.current
      s.dims = { w, h }

      s.vessels = buildVessels(w, h)
      s.rbcs = buildRBCs()
      s.echoes = []
      s.pulse = {
        x: PROBE_FACE_X,
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
        x: PROBE_FACE_X,
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
      s.time += 0.016

      const probeTop = h * PROBE_TOP_FRAC
      const probeBot = h * PROBE_BOT_FRAC
      const probeH = probeBot - probeTop

      // ─── Move RBCs ─────────────────────────────────────────────
      for (const rbc of s.rbcs) {
        rbc.t += rbc.speed
        if (rbc.t > 1) rbc.t -= 1
        rbc.rotation += rbc.rotSpeed
      }

      // ─── Update pulse ──────────────────────────────────────────
      if (s.pulse.active) {
        s.pulse.x += WAVE_SPEED

        for (const rbc of s.rbcs) {
          if (rbc.hit) continue
          const vessel = s.vessels[rbc.vesselIdx]
          const pos = getVesselPoint(vessel, rbc.t)
          // Only hit RBCs that are within the visible canvas AND within the beam field of view
          const inCanvas = pos.x >= 0 && pos.x <= w && pos.y >= 0 && pos.y <= h
          const inBeam = pos.y >= probeTop && pos.y <= probeBot
          const pulseReached = s.pulse.x >= pos.x - rbc.size
          if (inCanvas && inBeam && pulseReached) {
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

      // ─── Update echoes ─────────────────────────────────────────
      for (const echo of s.echoes) {
        echo.radius += ECHO_SPEED
        echo.opacity = Math.max(0, 0.9 - (s.time - echo.birthTime) * 0.1)
      }
      s.echoes = s.echoes.filter((e) => e.opacity > 0.01)

      // ─── Auto-restart ──────────────────────────────────────────
      if (!s.pulse.active && s.echoes.length === 0 && !s.restartTimer) {
        s.restartTimer = window.setTimeout(restartPulse, RESTART_DELAY)
      }

      // ─── DRAW ──────────────────────────────────────────────────

      // Background
      const bgGrad = ctx.createRadialGradient(
        w * 0.45, h * 0.5, 0,
        w * 0.5, h * 0.5, w * 0.85
      )
      bgGrad.addColorStop(0, "#0f1318")
      bgGrad.addColorStop(0.6, "#0a0e14")
      bgGrad.addColorStop(1, "#060810")
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // Subtle tissue texture
      ctx.globalAlpha = 0.03
      for (let i = 0; i < 200; i++) {
        const tx = (i * 137.5) % w
        const ty = (i * 97.3 + 50) % h
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
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
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
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()

        // Vessel wall edges (membrane)
        ctx.lineWidth = 1
        ctx.strokeStyle = "rgba(120,50,60,0.35)"
        for (const sign of [-1, 1]) {
          ctx.beginPath()
          for (let i = 0; i < pts.length; i++) {
            const angle =
              i < pts.length - 1
                ? Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
                : Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x)
            const nx = pts[i].x + Math.cos(angle + (sign * Math.PI) / 2) * r
            const ny = pts[i].y + Math.sin(angle + (sign * Math.PI) / 2) * r
            if (i === 0) ctx.moveTo(nx, ny)
            else ctx.lineTo(nx, ny)
          }
          ctx.stroke()
        }
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
        ctx.fillStyle = isGlowing ? "rgba(90,12,12,0.5)" : "rgba(50,6,6,0.55)"
        ctx.beginPath()
        ctx.ellipse(0, 0, r * 0.32, r * 0.2, 0, 0, Math.PI * 2)
        ctx.fill()

        // Highlight
        ctx.fillStyle = "rgba(255,255,255,0.07)"
        ctx.beginPath()
        ctx.ellipse(-r * 0.2, -r * 0.12, r * 0.28, r * 0.12, -0.3, 0, Math.PI * 2)
        ctx.fill()

        ctx.shadowBlur = 0
        ctx.restore()

        // RBC label (only for labeled ones)
        if (rbc.labeled) {
          ctx.save()
          ctx.font = "600 11px system-ui, sans-serif"
          ctx.fillStyle = "rgba(255,100,100,0.9)"
          ctx.textAlign = "left"
          ctx.textBaseline = "middle"

          const lx = pos.x + rbc.size + 6
          const ly = pos.y - rbc.size - 6

          // Leader line
          ctx.strokeStyle = "rgba(255,100,100,0.4)"
          ctx.lineWidth = 0.8
          ctx.setLineDash([3, 2])
          ctx.beginPath()
          ctx.moveTo(pos.x + rbc.size + 1, pos.y)
          ctx.lineTo(lx, ly)
          ctx.stroke()
          ctx.setLineDash([])

          // Label background
          const text = "Red Blood Cell"
          const tm = ctx.measureText(text)
          const px = 5
          const py = 3
          ctx.fillStyle = "rgba(10,12,18,0.85)"
          ctx.beginPath()
          ctx.roundRect(lx - px, ly - 7 - py, tm.width + px * 2, 14 + py * 2, 3)
          ctx.fill()
          ctx.strokeStyle = "rgba(255,100,100,0.5)"
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.roundRect(lx - px, ly - 7 - py, tm.width + px * 2, 14 + py * 2, 3)
          ctx.stroke()

          ctx.fillStyle = "rgba(255,100,100,0.9)"
          ctx.fillText(text, lx, ly)
          ctx.restore()
        }
      }

      // ─── Incident pulse wavefront ────────────��────────────────
      if (s.pulse.active && s.pulse.x > PROBE_FACE_X) {
        ctx.save()
        ctx.globalAlpha = s.pulse.opacity

        const wfGrad = ctx.createLinearGradient(
          s.pulse.x, probeTop, s.pulse.x, probeBot
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

        ctx.shadowBlur = 0
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(s.pulse.x, probeTop)
        ctx.lineTo(s.pulse.x, probeBot)
        ctx.stroke()

        ctx.restore()
      }

      // ─── Transducer probe (detailed) ───────────────────────────
      const faceX = PROBE_FACE_X
      const housingLeft = faceX - PROBE_HOUSING_WIDTH
      const bodyLeft = housingLeft - PROBE_BODY_WIDTH

      // Probe body (wider tapered section)
      const bodyGrad = ctx.createLinearGradient(bodyLeft, 0, housingLeft, 0)
      bodyGrad.addColorStop(0, "#0e1520")
      bodyGrad.addColorStop(0.4, "#18273a")
      bodyGrad.addColorStop(1, "#1a2d42")
      ctx.fillStyle = bodyGrad

      const bodyTop = probeTop + probeH * 0.15
      const bodyBot = probeBot - probeH * 0.15
      ctx.beginPath()
      ctx.moveTo(bodyLeft, bodyTop - 10)
      ctx.lineTo(housingLeft, probeTop - 4)
      ctx.lineTo(housingLeft, probeBot + 4)
      ctx.lineTo(bodyLeft, bodyBot + 10)
      ctx.closePath()
      ctx.fill()

      // Body outline
      ctx.strokeStyle = "rgba(56,189,248,0.1)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(bodyLeft, bodyTop - 10)
      ctx.lineTo(housingLeft, probeTop - 4)
      ctx.lineTo(housingLeft, probeBot + 4)
      ctx.lineTo(bodyLeft, bodyBot + 10)
      ctx.closePath()
      ctx.stroke()

      // Cable indication at far left
      ctx.strokeStyle = "rgba(56,189,248,0.07)"
      ctx.lineWidth = 8
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(bodyLeft, (bodyTop + bodyBot) / 2)
      ctx.lineTo(0, (bodyTop + bodyBot) / 2)
      ctx.stroke()
      ctx.lineCap = "butt"

      // Housing block
      const housingGrad = ctx.createLinearGradient(housingLeft, 0, faceX, 0)
      housingGrad.addColorStop(0, "#1a2d42")
      housingGrad.addColorStop(0.5, "#223a52")
      housingGrad.addColorStop(1, "#1c3048")
      ctx.fillStyle = housingGrad
      ctx.beginPath()
      ctx.roundRect(
        housingLeft,
        probeTop - 4,
        PROBE_HOUSING_WIDTH,
        probeH + 8,
        [2, 0, 0, 2]
      )
      ctx.fill()

      // Housing outline
      ctx.strokeStyle = "rgba(56,189,248,0.12)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(
        housingLeft,
        probeTop - 4,
        PROBE_HOUSING_WIDTH,
        probeH + 8,
        [2, 0, 0, 2]
      )
      ctx.stroke()

      // ─── Individual transducer elements ────────────────────────
      const elementGap = 2.5
      const totalGaps = (NUM_ELEMENTS - 1) * elementGap
      const elementH = (probeH - totalGaps) / NUM_ELEMENTS
      const elementW = PROBE_HOUSING_WIDTH * 0.55
      const elementLeft = faceX - elementW

      for (let i = 0; i < NUM_ELEMENTS; i++) {
        const ey = probeTop + i * (elementH + elementGap)

        // Piezo element
        const active =
          s.pulse.active && s.pulse.x < faceX + 30 && s.pulse.x >= faceX - 5

        // Gap background (dark separator between elements)
        if (i > 0) {
          ctx.fillStyle = "#080d14"
          ctx.fillRect(elementLeft - 1, ey - elementGap, elementW + 2, elementGap)
        }

        // Element fill - stronger, more saturated colours
        const elGrad = ctx.createLinearGradient(elementLeft, 0, faceX, 0)
        if (active) {
          elGrad.addColorStop(0, "rgba(56,189,248,0.3)")
          elGrad.addColorStop(0.4, "rgba(56,189,248,0.65)")
          elGrad.addColorStop(1, "rgba(100,210,255,0.85)")
        } else {
          elGrad.addColorStop(0, "rgba(35,65,100,0.55)")
          elGrad.addColorStop(0.5, "rgba(50,90,130,0.65)")
          elGrad.addColorStop(1, "rgba(45,80,115,0.55)")
        }

        ctx.fillStyle = elGrad
        ctx.fillRect(elementLeft, ey, elementW, elementH)

        // Element border - stronger
        ctx.strokeStyle = active
          ? "rgba(56,189,248,0.7)"
          : "rgba(56,189,248,0.25)"
        ctx.lineWidth = 0.8
        ctx.strokeRect(elementLeft, ey, elementW, elementH)

        // Inner highlight line on each element
        ctx.strokeStyle = active
          ? "rgba(140,220,255,0.35)"
          : "rgba(56,189,248,0.08)"
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(elementLeft + 1, ey + 1)
        ctx.lineTo(faceX - 1, ey + 1)
        ctx.stroke()
      }

      // Emitting face bright edge
      ctx.save()
      ctx.shadowColor = "#38bdf8"
      ctx.shadowBlur = s.pulse.active && s.pulse.x < faceX + 30 ? 20 : 6
      ctx.fillStyle = s.pulse.active && s.pulse.x < faceX + 30
        ? "rgba(56,189,248,0.8)"
        : "rgba(56,189,248,0.3)"
      ctx.fillRect(faceX - 1.5, probeTop, 1.5, probeH)
      ctx.restore()

      // ─── Matching layer (thin strip between elements and face) ─
      ctx.fillStyle = "rgba(70,130,170,0.15)"
      ctx.fillRect(faceX - 3, probeTop, 3, probeH)

      // ─── Backing material (behind elements) ────────────────────
      const backingW = PROBE_HOUSING_WIDTH - elementW
      ctx.fillStyle = "rgba(15,25,35,0.8)"
      ctx.fillRect(housingLeft, probeTop, backingW, probeH)

      // Tiny wiring lines inside housing
      ctx.strokeStyle = "rgba(56,189,248,0.06)"
      ctx.lineWidth = 0.5
      for (let i = 0; i < NUM_ELEMENTS; i += 4) {
        const ey = probeTop + i * (elementH + elementGap) + elementH / 2
        ctx.beginPath()
        ctx.moveTo(housingLeft + 4, ey)
        ctx.lineTo(elementLeft, ey)
        ctx.stroke()
      }

      // ─── Probe label ──────────────────────────────────────────
      ctx.save()
      ctx.font = "600 11px system-ui, sans-serif"
      ctx.fillStyle = "rgba(56,189,248,0.85)"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"

      const labelX = (bodyLeft + housingLeft) / 2
      const labelY = probeBot + 28

      // Leader line from probe body down
      ctx.strokeStyle = "rgba(56,189,248,0.3)"
      ctx.lineWidth = 0.8
      ctx.setLineDash([3, 2])
      ctx.beginPath()
      ctx.moveTo(labelX, probeBot + 6)
      ctx.lineTo(labelX, labelY - 10)
      ctx.stroke()
      ctx.setLineDash([])

      // Label background
      const probeLabel = "Transducer Probe"
      const plm = ctx.measureText(probeLabel)
      const lpx = 8
      const lpy = 4
      ctx.fillStyle = "rgba(10,12,18,0.85)"
      ctx.beginPath()
      ctx.roundRect(
        labelX - plm.width / 2 - lpx,
        labelY - 7 - lpy,
        plm.width + lpx * 2,
        14 + lpy * 2,
        3
      )
      ctx.fill()
      ctx.strokeStyle = "rgba(56,189,248,0.35)"
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.roundRect(
        labelX - plm.width / 2 - lpx,
        labelY - 7 - lpy,
        plm.width + lpx * 2,
        14 + lpy * 2,
        3
      )
      ctx.stroke()

      ctx.fillStyle = "rgba(56,189,248,0.85)"
      ctx.fillText(probeLabel, labelX, labelY)
      ctx.restore()

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
