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
const SKULL_THICKNESS = 28 // temporal bone thickness in px
const SKULL_LEFT = PROBE_FACE_X + 4 // small gap for coupling gel
const SKULL_RIGHT = SKULL_LEFT + SKULL_THICKNESS

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
  const lastTimeRef = useRef<number>(0)
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
    const overflow = 80
    // Vessels start past the skull inner surface
    const vesselStartX = SKULL_RIGHT + 8

    // Middle cerebral artery -- enters from right, curves across middle, exits right
    {
      const pts: { x: number; y: number }[] = []
      const cy = h * 0.42
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = vesselStartX + frac * (w - vesselStartX + overflow)
        const y =
          cy +
          Math.sin(frac * Math.PI * 2) * h * 0.04 +
          Math.cos(frac * Math.PI * 0.8) * h * 0.02
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.04, flowSpeed: 0.0003 })
    }

    // Anterior cerebral artery -- enters from right, curves up and off top edge
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 45; i++) {
        const frac = i / 45
        const x = vesselStartX + frac * (w - vesselStartX + overflow)
        // Starts at ~20%, curves gently upward, exits off top
        const y =
          h * 0.2 -
          frac * frac * h * 0.15 +
          Math.sin(frac * Math.PI * 2.5) * h * 0.025
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.025, flowSpeed: 0.00018 })
    }

    // Posterior cerebral artery -- enters from right, curves down and off bottom
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 45; i++) {
        const frac = i / 45
        const x = vesselStartX + frac * (w - vesselStartX + overflow)
        // Starts at ~70%, curves gently downward, exits off bottom
        const y =
          h * 0.68 +
          frac * frac * h * 0.12 +
          Math.sin(frac * Math.PI * 2 + 1) * h * 0.025
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.028, flowSpeed: 0.00022 })
    }

    // Small arteriole -- between anterior and middle, curves up off top
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = vesselStartX + w * 0.15 + frac * (w * 0.6 + overflow)
        const y =
          h * 0.3 -
          frac * h * 0.25 +
          Math.sin(frac * Math.PI * 3) * h * 0.02
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.015, flowSpeed: 0.00012 })
    }

    // Small arteriole -- between middle and posterior, curves down off bottom
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 35; i++) {
        const frac = i / 35
        const x = vesselStartX + w * 0.1 + frac * (w * 0.65 + overflow)
        const y =
          h * 0.58 +
          frac * h * 0.22 +
          Math.sin(frac * Math.PI * 2.5 + 1) * h * 0.02
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

    const animate = (timestamp: number) => {
      const s = stateRef.current
      if (!s.initialized) {
        lastTimeRef.current = timestamp
        animFrameRef.current = requestAnimationFrame(animate)
        return
      }

      // Real delta time, capped to avoid spiral of death
      const rawDt = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0.016
      const dt = Math.min(rawDt, 0.033) // cap at ~30fps equivalent
      lastTimeRef.current = timestamp

      const { w, h } = s.dims
      s.time += dt

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
          // Only hit RBCs that are past the skull, within canvas, and in the beam
          const inFrontOfProbe = pos.x >= SKULL_RIGHT + rbc.size
          const inCanvas = pos.x <= w && pos.y >= 0 && pos.y <= h
          const inBeam = pos.y >= probeTop && pos.y <= probeBot
          const pulseReached = s.pulse.x >= pos.x - rbc.size
          if (inFrontOfProbe && inCanvas && inBeam && pulseReached) {
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
        echo.opacity = Math.max(0, 0.9 - (s.time - echo.birthTime) * 0.12)
      }
      // Aggressively prune: remove faded echoes and any that have expanded well past the probe
      s.echoes = s.echoes.filter((e) => {
        if (e.opacity < 0.02) return false
        // If echo has expanded far enough to cover the whole scene, remove it
        const maxDim = Math.max(w, h)
        if (e.radius > maxDim * 1.5) return false
        return true
      })

      // ─── Detect echoes hitting transducer elements (per-element timing) ──
      const elementGapCalc = 2.5
      const totalGapsCalc = (NUM_ELEMENTS - 1) * elementGapCalc
      const elementHCalc = (probeH - totalGapsCalc) / NUM_ELEMENTS

      // Decay existing activations
      for (let i = 0; i < NUM_ELEMENTS; i++) {
        s.elementActivations[i] = Math.max(0, s.elementActivations[i] - 0.025)
      }

      // For each element, compute exact distance from each echo center
      // to that element's position on the probe face. The echo circle
      // reaches each element at a different time based on geometry.
      for (const echo of s.echoes) {
        if (echo.opacity < 0.05) continue
        // Only consider echoes that originated to the right of the probe
        if (echo.cx < PROBE_FACE_X) continue

        const dx = echo.cx - PROBE_FACE_X

        for (let i = 0; i < NUM_ELEMENTS; i++) {
          const eCenterY = probeTop + i * (elementGapCalc + elementHCalc) + elementHCalc / 2
          const dy = echo.cy - eCenterY
          // True distance from echo origin to this specific element
          const distToElement = Math.sqrt(dx * dx + dy * dy)
          // Has the expanding circle just reached this element? (tight 2px window)
          if (Math.abs(echo.radius - distToElement) < 2) {
            s.elementActivations[i] = Math.min(4, s.elementActivations[i] + 0.6)
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
        // Skip if echo circle is entirely off-screen
        if (
          echo.cx + echo.radius < 0 ||
          echo.cx - echo.radius > w ||
          echo.cy + echo.radius < 0 ||
          echo.cy - echo.radius > h
        ) continue

        ctx.save()
        ctx.globalAlpha = echo.opacity * 0.7
        ctx.strokeStyle = "#ff5555"
        ctx.lineWidth = 1.5
        ctx.shadowColor = "#ff3333"
        ctx.shadowBlur = 6
        ctx.beginPath()
        ctx.arc(echo.cx, echo.cy, echo.radius, 0, Math.PI * 2)
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

        ctx.restore()
      }

      // ─── Transducer probe ─────────────────────────────────────
      // ─── Temporal bone (skull layer) -- drawn on top of vessels/echoes ──
      {
        const skullTop = 0
        const skullBot = h
        const skullH = h

        // Outer table (compact bone)
        const outerW = SKULL_THICKNESS * 0.3
        const outerGrad = ctx.createLinearGradient(SKULL_LEFT, 0, SKULL_LEFT + outerW, 0)
        outerGrad.addColorStop(0, "#d4c9b8")
        outerGrad.addColorStop(0.5, "#c8bba8")
        outerGrad.addColorStop(1, "#bfb198")
        ctx.fillStyle = outerGrad
        ctx.fillRect(SKULL_LEFT, skullTop, outerW, skullH)

        // Diploe (spongy bone, middle layer)
        const diploeLeft = SKULL_LEFT + outerW
        const diploeW = SKULL_THICKNESS * 0.45
        const diploeGrad = ctx.createLinearGradient(diploeLeft, 0, diploeLeft + diploeW, 0)
        diploeGrad.addColorStop(0, "#b5a58f")
        diploeGrad.addColorStop(0.5, "#c9b99e")
        diploeGrad.addColorStop(1, "#b5a58f")
        ctx.fillStyle = diploeGrad
        ctx.fillRect(diploeLeft, skullTop, diploeW, skullH)

        // Spongy pores in the diploe
        ctx.fillStyle = "rgba(80,65,48,0.35)"
        const poreSpacingY = 6
        const poreSpacingX = 7
        for (let py = skullTop + 3; py < skullBot - 3; py += poreSpacingY) {
          for (let px = diploeLeft + 2; px < diploeLeft + diploeW - 2; px += poreSpacingX) {
            const offsetX = ((py / poreSpacingY) % 2) * 3
            const rx = 1.0 + Math.sin(px * 0.7 + py * 0.3) * 0.6
            const ry = 0.8 + Math.cos(px * 0.5 + py * 0.8) * 0.4
            ctx.beginPath()
            ctx.ellipse(px + offsetX, py, rx, ry, 0, 0, Math.PI * 2)
            ctx.fill()
          }
        }

        // Inner table (compact bone)
        const innerLeft = diploeLeft + diploeW
        const innerW = SKULL_THICKNESS * 0.25
        const innerGrad = ctx.createLinearGradient(innerLeft, 0, innerLeft + innerW, 0)
        innerGrad.addColorStop(0, "#bfb198")
        innerGrad.addColorStop(0.5, "#c5b7a3")
        innerGrad.addColorStop(1, "#a89880")
        ctx.fillStyle = innerGrad
        ctx.fillRect(innerLeft, skullTop, innerW, skullH)

        // Periosteum line
        ctx.strokeStyle = "rgba(180,165,140,0.6)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(SKULL_LEFT, skullTop)
        ctx.lineTo(SKULL_LEFT, skullBot)
        ctx.stroke()

        // Dura mater line
        ctx.strokeStyle = "rgba(120,100,75,0.5)"
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(SKULL_RIGHT, skullTop)
        ctx.lineTo(SKULL_RIGHT, skullBot)
        ctx.stroke()

        // Bone edges
        ctx.strokeStyle = "rgba(90,78,60,0.4)"
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(SKULL_LEFT, skullTop)
        ctx.lineTo(SKULL_RIGHT, skullTop)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(SKULL_LEFT, skullBot)
        ctx.lineTo(SKULL_RIGHT, skullBot)
        ctx.stroke()

        // Layer division lines
        ctx.strokeStyle = "rgba(100,85,65,0.3)"
        ctx.lineWidth = 0.5
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(diploeLeft, skullTop)
        ctx.lineTo(diploeLeft, skullBot)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(innerLeft, skullTop)
        ctx.lineTo(innerLeft, skullBot)
        ctx.stroke()
        ctx.setLineDash([])

        // "Skull" label -- vertical text centered on the bone
        ctx.save()
        ctx.font = "700 11px system-ui, sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.translate(SKULL_LEFT + SKULL_THICKNESS / 2, h * 0.5)
        ctx.rotate(-Math.PI / 2)
        // Text shadow for readability
        ctx.fillStyle = "rgba(40,30,20,0.9)"
        ctx.fillText("Skull", 1, 1)
        ctx.fillStyle = "rgba(220,205,180,0.8)"
        ctx.fillText("Skull", 0, 0)
        ctx.restore()

        // Coupling gel strip
        const gelGrad = ctx.createLinearGradient(PROBE_FACE_X, 0, SKULL_LEFT, 0)
        gelGrad.addColorStop(0, "rgba(56,189,248,0.12)")
        gelGrad.addColorStop(1, "rgba(56,189,248,0.04)")
        ctx.fillStyle = gelGrad
        ctx.fillRect(PROBE_FACE_X, probeTop, SKULL_LEFT - PROBE_FACE_X, probeH)
      }

      // ─── Probe hardware ────────────────────────────────────────
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

        // Element fill -- transmit = cyan, receive = blue that gets brighter/whiter with more hits
        const elGrad = ctx.createLinearGradient(elementLeft, 0, faceX, 0)
        if (transmitting) {
          elGrad.addColorStop(0, "rgba(56,189,248,0.3)")
          elGrad.addColorStop(0.4, "rgba(56,189,248,0.65)")
          elGrad.addColorStop(1, "rgba(100,210,255,0.85)")
        } else if (receiveGlow > 0.05) {
          // g normalised 0-1 for base, intensity captures stacking (>1 = multiple hits)
          const g = Math.min(receiveGlow, 1)
          const intensity = Math.min(receiveGlow / 4, 1) // 0..1 over the full 0..4 range
          // Blend from blue toward white as intensity increases
          const r = Math.round(100 + intensity * 155)
          const gr = Math.round(180 + intensity * 75)
          const b = Math.round(240 + intensity * 15)
          elGrad.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(0.15 + g * 0.35 + intensity * 0.3, 1)})`)
          elGrad.addColorStop(0.4, `rgba(${r},${gr},${b},${Math.min(0.3 + g * 0.4 + intensity * 0.25, 1)})`)
          elGrad.addColorStop(1, `rgba(${r},${gr},${b},${Math.min(0.35 + g * 0.45 + intensity * 0.2, 1)})`)
        } else {
          elGrad.addColorStop(0, "rgba(35,65,100,0.55)")
          elGrad.addColorStop(0.5, "rgba(50,90,130,0.65)")
          elGrad.addColorStop(1, "rgba(45,80,115,0.55)")
        }

        ctx.fillStyle = elGrad
        ctx.fillRect(elementLeft, ey, elementW, elementH)

        // Element glow shadow for receive -- scales with stacked hits
        if (receiveGlow > 0.1) {
          const intensity = Math.min(receiveGlow / 4, 1)
          const glowR = Math.round(100 + intensity * 155)
          const glowG = Math.round(190 + intensity * 65)
          ctx.save()
          ctx.shadowColor = `rgba(${glowR},${glowG},255,${Math.min(receiveGlow * 0.4, 1)})`
          ctx.shadowBlur = Math.min(6 + receiveGlow * 5, 28)
          ctx.fillStyle = `rgba(${glowR},${glowG},255,${Math.min(receiveGlow * 0.15, 0.7)})`
          ctx.fillRect(elementLeft, ey, elementW, elementH)
          ctx.restore()
        }

        ctx.strokeStyle = transmitting
          ? "rgba(56,189,248,0.7)"
          : receiveGlow > 0.05
            ? `rgba(${Math.round(120 + Math.min(receiveGlow / 4, 1) * 135)},${Math.round(200 + Math.min(receiveGlow / 4, 1) * 55)},255,${Math.min(0.25 + receiveGlow * 0.25, 1)})`
            : "rgba(56,189,248,0.25)"
        ctx.lineWidth = 0.8
        ctx.strokeRect(elementLeft, ey, elementW, elementH)

        // Inner highlight
        ctx.strokeStyle = transmitting
          ? "rgba(140,220,255,0.35)"
          : receiveGlow > 0.05
            ? `rgba(${Math.round(140 + Math.min(receiveGlow / 4, 1) * 115)},${Math.round(210 + Math.min(receiveGlow / 4, 1) * 45)},255,${Math.min(receiveGlow * 0.2, 0.8)})`
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
            const fi = Math.min(rg / 4, 1)
            const fr = Math.round(100 + fi * 155)
            const fg = Math.round(190 + fi * 65)
            ctx.shadowColor = `rgba(${fr},${fg},255,${Math.min(rg * 0.4, 1)})`
            ctx.shadowBlur = Math.min(8 + rg * 5, 26)
            ctx.fillStyle = `rgba(${fr},${fg},255,${Math.min(0.25 + rg * 0.25, 1)})`
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
