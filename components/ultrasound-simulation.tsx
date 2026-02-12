"use client"

import { useEffect, useRef, useCallback } from "react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vessel {
  points: { x: number; y: number }[]
  radius: number
  flowSpeed: number // derived from vessel size
}

interface RBC {
  vesselIdx: number
  t: number
  size: number
  rotation: number
  rotSpeed: number
  hit: boolean
  hitTime: number
  labeled: boolean
  clumpId: number // -1 = solo, otherwise shared id for clumped cells
  clumpOffset: number // slight t-offset within clump
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

const WAVE_SPEED = 2.6
const ECHO_SPEED = 2.0
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
    elementActivations: number[]
  }>({
    vessels: [],
    rbcs: [],
    echoes: [],
    pulse: { x: 0, opacity: 1, active: true },
    time: 0,
    initialized: false,
    dims: { w: 0, h: 0 },
    restartTimer: null,
    elementActivations: new Array(NUM_ELEMENTS).fill(0),
  })

  const buildVessels = useCallback((w: number, h: number): Vessel[] => {
    const vessels: Vessel[] = []
    const overflow = 80 // extend beyond canvas edges

    // Middle cerebral artery -- extends edge to edge
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.45
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = -overflow + frac * (w + overflow * 2)
        const y =
          cy +
          Math.sin(frac * Math.PI * 3) * h * 0.05 +
          Math.cos(frac * Math.PI * 1.5) * h * 0.03
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.04, flowSpeed: 0.0003 })
    }

    // Anterior cerebral artery -- extends edge to edge
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.22
      for (let i = 0; i <= 45; i++) {
        const frac = i / 45
        const x = -overflow + frac * (w + overflow * 2)
        const y =
          cy +
          Math.sin(frac * Math.PI * 2.3 + 0.5) * h * 0.06 +
          Math.sin(frac * Math.PI * 5) * h * 0.015
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.025, flowSpeed: 0.00018 })
    }

    // Posterior cerebral artery -- extends edge to edge
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.73
      for (let i = 0; i <= 45; i++) {
        const frac = i / 45
        const x = -overflow + frac * (w + overflow * 2)
        const y =
          cy +
          Math.sin(frac * Math.PI * 2.8 + 1) * h * 0.05 +
          Math.cos(frac * Math.PI * 4.5) * h * 0.012
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.028, flowSpeed: 0.00022 })
    }

    // Branching arteriole (ascending, crosses top edge)
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = -overflow * 0.5 + w * 0.15 + frac * (w * 0.9 + overflow)
        const y =
          h * 0.5 -
          frac * h * 0.45 +
          Math.sin(frac * Math.PI * 4) * h * 0.025
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.015, flowSpeed: 0.00012 })
    }

    // Branching arteriole (descending, crosses bottom edge)
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = -overflow * 0.5 + w * 0.2 + frac * (w * 0.85 + overflow)
        const y =
          h * 0.48 +
          frac * h * 0.42 +
          Math.sin(frac * Math.PI * 3 + 1) * h * 0.03
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.016, flowSpeed: 0.00015 })
    }

    return vessels
  }, [])

  const buildRBCs = useCallback((): RBC[] => {
    const rbcs: RBC[] = []
    // distribution per vessel: [solo cells, clumps of 2-3]
    const distribution = [
      { solo: 1, clumps: [2] },      // middle cerebral: 1 solo + 1 clump of 2
      { solo: 1, clumps: [3] },      // anterior: 1 solo + 1 clump of 3
      { solo: 2, clumps: [] },       // posterior: 2 solo
      { solo: 1, clumps: [2] },      // ascending arteriole: 1 solo + 1 clump of 2
      { solo: 1, clumps: [] },       // descending arteriole: 1 solo
    ]
    let firstLabeled = false
    let clumpIdCounter = 0

    for (let vi = 0; vi < 5; vi++) {
      const cfg = distribution[vi]

      // Solo cells - spread out along the vessel
      for (let i = 0; i < cfg.solo; i++) {
        const labeled = !firstLabeled && vi === 0 && i === 0
        if (labeled) firstLabeled = true
        rbcs.push({
          vesselIdx: vi,
          t: 0.4 + (i / Math.max(1, cfg.solo)) * 0.4 + Math.random() * 0.1,
          size: 3 + Math.random() * 2.5,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.02,
          hit: false,
          hitTime: 0,
          labeled,
          clumpId: -1,
          clumpOffset: 0,
        })
      }

      // Clumped cells - tight groups with very small t-offsets
      for (const clumpSize of cfg.clumps) {
        const clumpCenter = 0.55 + Math.random() * 0.3
        const cid = clumpIdCounter++
        for (let j = 0; j < clumpSize; j++) {
          // Very small offset so they stay close together
          const offset = (j - (clumpSize - 1) / 2) * 0.012
          rbcs.push({
            vesselIdx: vi,
            t: clumpCenter + offset,
            size: 3 + Math.random() * 2,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.015,
            hit: false,
            hitTime: 0,
            labeled: false,
            clumpId: cid,
            clumpOffset: offset,
          })
        }
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
      s.pulse = { x: PROBE_FACE_X, opacity: 1, active: true }
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
      s.pulse = { x: PROBE_FACE_X, opacity: 1, active: true }
      s.elementActivations = new Array(NUM_ELEMENTS).fill(0)
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

      // ─── Move RBCs (all cells in same vessel move at vessel's flow speed) ──
      for (const rbc of s.rbcs) {
        const vessel = s.vessels[rbc.vesselIdx]
        rbc.t += vessel.flowSpeed
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
          const inCanvas =
            pos.x >= 0 && pos.x <= w && pos.y >= 0 && pos.y <= h
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

      // ─── Detect echoes hitting transducer elements ─────────────
      const elementGapCalc = 2.5
      const totalGapsCalc = (NUM_ELEMENTS - 1) * elementGapCalc
      const elementHCalc = (probeH - totalGapsCalc) / NUM_ELEMENTS

      // Decay existing activations
      for (let i = 0; i < NUM_ELEMENTS; i++) {
        s.elementActivations[i] = Math.max(0, s.elementActivations[i] - 0.02)
      }

      // Check each echo against each element
      for (const echo of s.echoes) {
        if (echo.opacity < 0.05) continue
        // Distance from echo center to the probe face
        const dx = echo.cx - PROBE_FACE_X
        const distToFace = Math.abs(echo.radius - Math.abs(dx))
        // Only activate when the echo wavefront is crossing the face (within a few px)
        if (distToFace > 4) continue
        // Only activate if the echo is expanding back toward the probe
        if (echo.cx < PROBE_FACE_X) continue

        for (let i = 0; i < NUM_ELEMENTS; i++) {
          const eCenterY = probeTop + i * (elementHCalc + elementGapCalc) + elementHCalc / 2
          const dy = echo.cy - eCenterY
          const distFromEchoCenter = Math.sqrt(dx * dx + dy * dy)
          // Check if this element's y-position is within the echo circle
          if (Math.abs(distFromEchoCenter - echo.radius) < elementHCalc * 0.8) {
            s.elementActivations[i] = Math.min(1, s.elementActivations[i] + 0.4)
          }
        }
      }

      // ─── Auto-restart ──────────────────────────────────────────
      if (!s.pulse.active && s.echoes.length === 0 && !s.restartTimer) {
        s.restartTimer = window.setTimeout(restartPulse, RESTART_DELAY)
      }

      // ─── DRAW ──────────────────────────────────────────────────

      ctx.fillStyle = "#0a0a0f"
      ctx.fillRect(0, 0, w, h)

      // ─── Draw vessels (cerebral vasculature) ───────────────────
      for (const vessel of s.vessels) {
        const pts = vessel.points
        const r = vessel.radius

        // Outer adventitia layer
        ctx.save()
        ctx.lineWidth = r * 2 + 6
        ctx.strokeStyle = "rgba(55,20,28,0.5)"
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()

        // Vessel wall (tunica media)
        ctx.lineWidth = r * 2 + 3
        ctx.strokeStyle = "rgba(70,28,35,0.6)"
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()

        // Vessel lumen (dark interior with blood)
        ctx.lineWidth = r * 2
        const lumenGrad = ctx.createLinearGradient(0, 0, w, 0)
        lumenGrad.addColorStop(0, "rgba(35,8,12,0.85)")
        lumenGrad.addColorStop(0.5, "rgba(50,12,18,0.85)")
        lumenGrad.addColorStop(1, "rgba(35,8,12,0.85)")
        ctx.strokeStyle = lumenGrad
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()

        // Intima (inner membrane highlight)
        ctx.lineWidth = 0.8
        ctx.strokeStyle = "rgba(130,50,60,0.3)"
        for (const sign of [-1, 1]) {
          ctx.beginPath()
          for (let i = 0; i < pts.length; i++) {
            const angle =
              i < pts.length - 1
                ? Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
                : Math.atan2(
                    pts[i].y - pts[i - 1].y,
                    pts[i].x - pts[i - 1].x
                  )
            const nx =
              pts[i].x + Math.cos(angle + (sign * Math.PI) / 2) * (r - 0.5)
            const ny =
              pts[i].y + Math.sin(angle + (sign * Math.PI) / 2) * (r - 0.5)
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

        // RBC label
        if (rbc.labeled) {
          ctx.save()
          ctx.font = "600 11px system-ui, sans-serif"
          ctx.fillStyle = "rgba(255,100,100,0.9)"
          ctx.textAlign = "left"
          ctx.textBaseline = "middle"

          const lx = pos.x + rbc.size + 6
          const ly = pos.y - rbc.size - 6

          ctx.strokeStyle = "rgba(255,100,100,0.4)"
          ctx.lineWidth = 0.8
          ctx.setLineDash([3, 2])
          ctx.beginPath()
          ctx.moveTo(pos.x + rbc.size + 1, pos.y)
          ctx.lineTo(lx, ly)
          ctx.stroke()
          ctx.setLineDash([])

          const text = "Red Blood Cell"
          const tm = ctx.measureText(text)
          const px = 5
          const py = 3
          ctx.fillStyle = "rgba(10,8,10,0.9)"
          ctx.beginPath()
          ctx.roundRect(
            lx - px,
            ly - 7 - py,
            tm.width + px * 2,
            14 + py * 2,
            3
          )
          ctx.fill()
          ctx.strokeStyle = "rgba(255,100,100,0.5)"
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.roundRect(
            lx - px,
            ly - 7 - py,
            tm.width + px * 2,
            14 + py * 2,
            3
          )
          ctx.stroke()

          ctx.fillStyle = "rgba(255,100,100,0.9)"
          ctx.fillText(text, lx, ly)
          ctx.restore()
        }
      }

      // ─── Incident pulse wavefront ────────���────────────────────
      if (s.pulse.active && s.pulse.x > PROBE_FACE_X) {
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

        ctx.shadowBlur = 0
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(s.pulse.x, probeTop)
        ctx.lineTo(s.pulse.x, probeBot)
        ctx.stroke()

        ctx.restore()
      }

      // ─── Transducer probe ─────────────────────────────────────
      const faceX = PROBE_FACE_X
      const housingLeft = faceX - PROBE_HOUSING_WIDTH
      const bodyLeft = housingLeft - PROBE_BODY_WIDTH

      // Probe body
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

      ctx.strokeStyle = "rgba(56,189,248,0.1)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(bodyLeft, bodyTop - 10)
      ctx.lineTo(housingLeft, probeTop - 4)
      ctx.lineTo(housingLeft, probeBot + 4)
      ctx.lineTo(bodyLeft, bodyBot + 10)
      ctx.closePath()
      ctx.stroke()

      // Cable
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
        const transmitting =
          s.pulse.active && s.pulse.x < faceX + 30 && s.pulse.x >= faceX - 5
        const receiveGlow = s.elementActivations[i] || 0

        // Dark separator
        if (i > 0) {
          ctx.fillStyle = "#080d14"
          ctx.fillRect(
            elementLeft - 1,
            ey - elementGap,
            elementW + 2,
            elementGap
          )
        }

        // Element fill -- transmit = cyan, receive = lighter blue
        const elGrad = ctx.createLinearGradient(elementLeft, 0, faceX, 0)
        if (transmitting) {
          elGrad.addColorStop(0, "rgba(56,189,248,0.3)")
          elGrad.addColorStop(0.4, "rgba(56,189,248,0.65)")
          elGrad.addColorStop(1, "rgba(100,210,255,0.85)")
        } else if (receiveGlow > 0.05) {
          const g = receiveGlow
          elGrad.addColorStop(0, `rgba(100,180,240,${0.15 + g * 0.3})`)
          elGrad.addColorStop(0.4, `rgba(120,200,255,${0.3 + g * 0.4})`)
          elGrad.addColorStop(1, `rgba(140,215,255,${0.35 + g * 0.45})`)
        } else {
          elGrad.addColorStop(0, "rgba(35,65,100,0.55)")
          elGrad.addColorStop(0.5, "rgba(50,90,130,0.65)")
          elGrad.addColorStop(1, "rgba(45,80,115,0.55)")
        }

        ctx.fillStyle = elGrad
        ctx.fillRect(elementLeft, ey, elementW, elementH)

        // Element glow shadow for receive
        if (receiveGlow > 0.1) {
          ctx.save()
          ctx.shadowColor = `rgba(100,190,255,${receiveGlow * 0.6})`
          ctx.shadowBlur = 8 * receiveGlow
          ctx.fillStyle = `rgba(110,195,255,${receiveGlow * 0.25})`
          ctx.fillRect(elementLeft, ey, elementW, elementH)
          ctx.restore()
        }

        ctx.strokeStyle = transmitting
          ? "rgba(56,189,248,0.7)"
          : receiveGlow > 0.05
            ? `rgba(120,200,255,${0.25 + receiveGlow * 0.4})`
            : "rgba(56,189,248,0.25)"
        ctx.lineWidth = 0.8
        ctx.strokeRect(elementLeft, ey, elementW, elementH)

        // Inner highlight
        ctx.strokeStyle = transmitting
          ? "rgba(140,220,255,0.35)"
          : receiveGlow > 0.05
            ? `rgba(140,210,255,${receiveGlow * 0.25})`
            : "rgba(56,189,248,0.08)"
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(elementLeft + 1, ey + 1)
        ctx.lineTo(faceX - 1, ey + 1)
        ctx.stroke()
      }

      // Emitting face bright edge -- show per-element receive glow
      const isTransmitting = s.pulse.active && s.pulse.x < faceX + 30
      const maxReceive = Math.max(...s.elementActivations)
      ctx.save()
      if (isTransmitting) {
        ctx.shadowColor = "#38bdf8"
        ctx.shadowBlur = 20
        ctx.fillStyle = "rgba(56,189,248,0.8)"
        ctx.fillRect(faceX - 1.5, probeTop, 1.5, probeH)
      } else {
        // Draw face edge per-element so receive glow shows individually
        for (let i = 0; i < NUM_ELEMENTS; i++) {
          const ey = probeTop + i * (elementH + elementGap)
          const rg = s.elementActivations[i] || 0
          if (rg > 0.05) {
            ctx.shadowColor = `rgba(100,190,255,${rg * 0.7})`
            ctx.shadowBlur = 10 * rg
            ctx.fillStyle = `rgba(120,200,255,${0.25 + rg * 0.5})`
          } else {
            ctx.shadowColor = "#38bdf8"
            ctx.shadowBlur = 4
            ctx.fillStyle = "rgba(56,189,248,0.25)"
          }
          ctx.fillRect(faceX - 1.5, ey, 1.5, elementH)
        }
      }
      ctx.restore()

      // Matching layer
      ctx.fillStyle = "rgba(70,130,170,0.15)"
      ctx.fillRect(faceX - 3, probeTop, 3, probeH)

      // Backing material
      const backingW = PROBE_HOUSING_WIDTH - elementW
      ctx.fillStyle = "rgba(15,25,35,0.8)"
      ctx.fillRect(housingLeft, probeTop, backingW, probeH)

      // Tiny wiring lines
      ctx.strokeStyle = "rgba(56,189,248,0.06)"
      ctx.lineWidth = 0.5
      for (let i = 0; i < NUM_ELEMENTS; i += 4) {
        const ey = probeTop + i * (elementH + elementGap) + elementH / 2
        ctx.beginPath()
        ctx.moveTo(housingLeft + 4, ey)
        ctx.lineTo(elementLeft, ey)
        ctx.stroke()
      }

      // ─── Probe label (positioned to the right of the probe face) ──
      ctx.save()
      ctx.font = "600 11px system-ui, sans-serif"
      ctx.textAlign = "left"
      ctx.textBaseline = "middle"

      const labelX = faceX + 14
      const labelY = probeTop - 18

      // Leader line from probe top to label
      ctx.strokeStyle = "rgba(56,189,248,0.3)"
      ctx.lineWidth = 0.8
      ctx.setLineDash([3, 2])
      ctx.beginPath()
      ctx.moveTo(faceX + 2, probeTop)
      ctx.lineTo(labelX - 4, labelY)
      ctx.stroke()
      ctx.setLineDash([])

      const probeLabel = "Transducer Probe"
      const plm = ctx.measureText(probeLabel)
      const lpx = 8
      const lpy = 4
      ctx.fillStyle = "rgba(10,8,10,0.9)"
      ctx.beginPath()
      ctx.roundRect(
        labelX - lpx,
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
        labelX - lpx,
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
        aria-label="Animation of ultrasound pulse propagating through cerebral blood vessels and producing spherical echoes off red blood cells"
      />
    </div>
  )
}
