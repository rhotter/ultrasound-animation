"use client"

import { useEffect, useRef, useCallback } from "react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vessel {
  points: { x: number; y: number }[]
  radius: number
  flowSpeed: number
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
  clumpId: number
  clumpOffset: number
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
const PROBE_TOP_FRAC = 0.12
const PROBE_BOT_FRAC = 0.88
const PROBE_FACE_X = 175
const PROBE_HOUSING_WIDTH = 32
const PROBE_BODY_WIDTH = 46
const PULSE_WIDTH = 3
const NUM_ELEMENTS = 32
const SKULL_THICKNESS = 28
const SKULL_LEFT = PROBE_FACE_X + 4
const SKULL_RIGHT = SKULL_LEFT + SKULL_THICKNESS
const MAX_ECHOES = 20

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function ptSegDistSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const projX = ax + t * dx, projY = ay + t * dy
  return (px - projX) ** 2 + (py - projY) ** 2
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
  // Offscreen canvas for static elements (skull, probe body)
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const staticDirtyRef = useRef(true)
  const stateRef = useRef<{
    vessels: Vessel[]
    rbcs: RBC[]
    echoes: SphericalEcho[]
    pulse: PulseWave
    time: number
    initialized: boolean
    dims: { w: number; h: number }
    elementActivations: number[]
    hintOpacity: number
  }>({
    vessels: [],
    rbcs: [],
    echoes: [],
    pulse: { x: 0, opacity: 1, active: true },
    time: 0,
    initialized: false,
    dims: { w: 0, h: 0 },
    elementActivations: new Array(NUM_ELEMENTS).fill(0),
    hintOpacity: 1,
  })

  const buildVessels = useCallback((w: number, h: number): Vessel[] => {
    const vessels: Vessel[] = []
    const overflow = 100
    const brainLeft = SKULL_RIGHT + 10

    // Upper vessel: enters from far top-left, diagonal downward-right, stays upper, exits right
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = brainLeft - overflow * 0.6 + frac * (w - brainLeft + overflow * 1.2)
        const y = -overflow + frac * h * 0.35 + Math.sin(frac * Math.PI * 2.4) * h * 0.08
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.025, flowSpeed: 0.00018 })
    }

    // Middle-upper: enters from left off-screen at upper-middle, horizontal-right, exits right-upper
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = brainLeft - overflow * 0.3 + frac * (w - brainLeft + overflow)
        const y = h * 0.25 + frac * h * 0.08 + Math.sin(frac * Math.PI * 3) * h * 0.06
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.04, flowSpeed: 0.0003 })
    }

    // Middle vessel: enters from bottom-left far off, sharp diagonal up-right, exits top-right
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = brainLeft - overflow * 0.7 + frac * (w - brainLeft + overflow * 1.4)
        const y = h + overflow * 0.7 - frac * (h * 0.95 + overflow * 0.9) + Math.sin(frac * Math.PI * 2.6) * h * 0.07
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.028, flowSpeed: 0.00022 })
    }

    // Middle-lower: enters from left at lower-middle, horizontal-right, exits right-lower
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = brainLeft - overflow * 0.2 + frac * (w - brainLeft + overflow)
        const y = h * 0.68 + frac * h * 0.12 + Math.sin(frac * Math.PI * 2.8) * h * 0.07
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.015, flowSpeed: 0.00012 })
    }

    // Lower vessel: enters from far bottom-left, diagonal upward-right, stays lower, exits right-bottom
    {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 50; i++) {
        const frac = i / 50
        const x = brainLeft - overflow * 0.5 + frac * (w - brainLeft + overflow * 1.1)
        const y = h + overflow * 0.5 - frac * h * 0.25 + Math.sin(frac * Math.PI * 2.2) * h * 0.08
        pts.push({ x, y })
      }
      vessels.push({ points: pts, radius: h * 0.016, flowSpeed: 0.00015 })
    }

    return vessels
  }, [])

  const buildRBCs = useCallback((): RBC[] => {
    const rbcs: RBC[] = []
    const distribution = [
      { solo: 1, clumps: [2] },
      { solo: 1, clumps: [3] },
      { solo: 2, clumps: [] },
      { solo: 1, clumps: [2] },
      { solo: 1, clumps: [] },
    ]
    let firstLabeled = false
    let clumpIdCounter = 0

    for (let vi = 0; vi < 5; vi++) {
      const cfg = distribution[vi]
      for (let i = 0; i < cfg.solo; i++) {
        const labeled = !firstLabeled && vi === 0 && i === 0
        if (labeled) firstLabeled = true
        rbcs.push({
          vesselIdx: vi,
          t: 0.4 + (i / Math.max(1, cfg.solo)) * 0.4 + Math.random() * 0.1,
          size: 3 + Math.random() * 2.5,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.02,
          hit: false, hitTime: 0, labeled,
          clumpId: -1, clumpOffset: 0,
        })
      }
      for (const clumpSize of cfg.clumps) {
        const clumpCenter = 0.55 + Math.random() * 0.3
        const cid = clumpIdCounter++
        for (let j = 0; j < clumpSize; j++) {
          const offset = (j - (clumpSize - 1) / 2) * 0.012
          rbcs.push({
            vesselIdx: vi,
            t: clumpCenter + offset,
            size: 3 + Math.random() * 2,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.015,
            hit: false, hitTime: 0, labeled: false,
            clumpId: cid, clumpOffset: offset,
          })
        }
      }
    }
    return rbcs
  }, [])

  // Pre-render static elements (skull, probe body) to an offscreen canvas
  const renderStatic = useCallback((w: number, h: number, dpr: number) => {
    if (!staticCanvasRef.current) {
      staticCanvasRef.current = document.createElement("canvas")
    }
    const offscreen = staticCanvasRef.current
    offscreen.width = w * dpr
    offscreen.height = h * dpr
    const ctx = offscreen.getContext("2d")!
    ctx.scale(dpr, dpr)

    const probeTop = h * PROBE_TOP_FRAC
    const probeBot = h * PROBE_BOT_FRAC
    const probeH = probeBot - probeTop
    const faceX = PROBE_FACE_X
    const housingLeft = faceX - PROBE_HOUSING_WIDTH
    const bodyLeft = housingLeft - PROBE_BODY_WIDTH
    const midY = (probeTop + probeBot) / 2
    const headTop = probeTop - 6
    const headBot = probeBot + 6
    const neckTop = probeTop + probeH * 0.12
    const neckBot = probeBot - probeH * 0.12
    const gripW = 62
    const gripLeft = bodyLeft - gripW
    const gripTop = midY - probeH * 0.18
    const gripBot = midY + probeH * 0.18
    const handleW = 50
    const handleLeft = gripLeft - handleW
    const handleTop = midY - probeH * 0.12
    const handleBot = midY + probeH * 0.12
    const cableExitX = handleLeft

    // ─── Skull ───────────────────────────────────────────────────
    const outerW = SKULL_THICKNESS * 0.3
    const outerGrad = ctx.createLinearGradient(SKULL_LEFT, 0, SKULL_LEFT + outerW, 0)
    outerGrad.addColorStop(0, "#d4c9b8")
    outerGrad.addColorStop(0.5, "#c8bba8")
    outerGrad.addColorStop(1, "#bfb198")
    ctx.fillStyle = outerGrad
    ctx.fillRect(SKULL_LEFT, 0, outerW, h)

    const diploeLeft = SKULL_LEFT + outerW
    const diploeW = SKULL_THICKNESS * 0.45
    const diploeGrad = ctx.createLinearGradient(diploeLeft, 0, diploeLeft + diploeW, 0)
    diploeGrad.addColorStop(0, "#b5a58f")
    diploeGrad.addColorStop(0.5, "#c9b99e")
    diploeGrad.addColorStop(1, "#b5a58f")
    ctx.fillStyle = diploeGrad
    ctx.fillRect(diploeLeft, 0, diploeW, h)

    // Spongy pores (static -- drawn once)
    ctx.fillStyle = "rgba(80,65,48,0.35)"
    for (let py = 3; py < h - 3; py += 6) {
      for (let px = diploeLeft + 2; px < diploeLeft + diploeW - 2; px += 7) {
        const offsetX = ((py / 6) % 2) * 3
        const rx = 1.0 + Math.sin(px * 0.7 + py * 0.3) * 0.6
        const ry = 0.8 + Math.cos(px * 0.5 + py * 0.8) * 0.4
        ctx.beginPath()
        ctx.ellipse(px + offsetX, py, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const innerLeft = diploeLeft + diploeW
    const innerW = SKULL_THICKNESS * 0.25
    const innerGrad = ctx.createLinearGradient(innerLeft, 0, innerLeft + innerW, 0)
    innerGrad.addColorStop(0, "#bfb198")
    innerGrad.addColorStop(0.5, "#c5b7a3")
    innerGrad.addColorStop(1, "#a89880")
    ctx.fillStyle = innerGrad
    ctx.fillRect(innerLeft, 0, innerW, h)

    // Bone edge lines
    ctx.strokeStyle = "rgba(180,165,140,0.6)"
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(SKULL_LEFT, 0); ctx.lineTo(SKULL_LEFT, h); ctx.stroke()
    ctx.strokeStyle = "rgba(120,100,75,0.5)"
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.moveTo(SKULL_RIGHT, 0); ctx.lineTo(SKULL_RIGHT, h); ctx.stroke()

    ctx.strokeStyle = "rgba(100,85,65,0.3)"
    ctx.lineWidth = 0.5
    ctx.setLineDash([2, 3])
    ctx.beginPath(); ctx.moveTo(diploeLeft, 0); ctx.lineTo(diploeLeft, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(innerLeft, 0); ctx.lineTo(innerLeft, h); ctx.stroke()
    ctx.setLineDash([])

    // Skull label
    ctx.save()
    ctx.font = "600 11px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    const skullLabelX = SKULL_RIGHT + 12
    const skullLabelY = h - 28
    ctx.strokeStyle = "rgba(200,180,150,0.35)"
    ctx.lineWidth = 0.8
    ctx.setLineDash([3, 2])
    ctx.beginPath(); ctx.moveTo(SKULL_RIGHT + 1, skullLabelY); ctx.lineTo(skullLabelX - 4, skullLabelY); ctx.stroke()
    ctx.setLineDash([])
    const skullText = "Skull"
    const skullTm = ctx.measureText(skullText)
    ctx.fillStyle = "rgba(10,8,10,0.9)"
    ctx.beginPath(); ctx.roundRect(skullLabelX - 7, skullLabelY - 11, skullTm.width + 14, 22, 3); ctx.fill()
    ctx.strokeStyle = "rgba(200,180,150,0.4)"
    ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.roundRect(skullLabelX - 7, skullLabelY - 11, skullTm.width + 14, 22, 3); ctx.stroke()
    ctx.fillStyle = "rgba(210,195,170,0.9)"
    ctx.fillText(skullText, skullLabelX, skullLabelY)
    ctx.restore()

    // Coupling gel
    const gelGrad = ctx.createLinearGradient(PROBE_FACE_X, 0, SKULL_LEFT, 0)
    gelGrad.addColorStop(0, "rgba(56,189,248,0.12)")
    gelGrad.addColorStop(1, "rgba(56,189,248,0.04)")
    ctx.fillStyle = gelGrad
    ctx.fillRect(PROBE_FACE_X, probeTop, SKULL_LEFT - PROBE_FACE_X, probeH)

    // ─── Probe body (cable, handle, grip, neck, head, housing) ──
    // Cable
    ctx.save()
    ctx.strokeStyle = "#0c1218"
    ctx.lineWidth = 14
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(cableExitX, midY)
    ctx.bezierCurveTo(cableExitX - 30, midY - 8, -20, midY + 5, -40, midY)
    ctx.stroke()
    ctx.strokeStyle = "rgba(56,189,248,0.04)"
    ctx.lineWidth = 12
    ctx.beginPath()
    ctx.moveTo(cableExitX, midY)
    ctx.bezierCurveTo(cableExitX - 30, midY - 8, -20, midY + 5, -40, midY)
    ctx.stroke()
    ctx.lineCap = "butt"
    ctx.restore()

    // Handle
    const handleGrad = ctx.createLinearGradient(handleLeft, handleTop, handleLeft, handleBot)
    handleGrad.addColorStop(0, "#10192a"); handleGrad.addColorStop(0.3, "#192d44")
    handleGrad.addColorStop(0.7, "#192d44"); handleGrad.addColorStop(1, "#0e1822")
    ctx.fillStyle = handleGrad
    ctx.beginPath(); ctx.roundRect(handleLeft, handleTop, handleW, handleBot - handleTop, 6); ctx.fill()
    ctx.strokeStyle = "rgba(56,189,248,0.08)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.roundRect(handleLeft, handleTop, handleW, handleBot - handleTop, 6); ctx.stroke()

    // Grip ridges
    ctx.strokeStyle = "rgba(56,189,248,0.06)"; ctx.lineWidth = 0.8
    for (let gy = handleTop + 6; gy < handleBot - 4; gy += 5) {
      ctx.beginPath(); ctx.moveTo(handleLeft + 6, gy); ctx.lineTo(handleLeft + handleW - 6, gy); ctx.stroke()
    }

    // Grip
    const gripGrad = ctx.createLinearGradient(gripLeft, gripTop, gripLeft, gripBot)
    gripGrad.addColorStop(0, "#0f1e30"); gripGrad.addColorStop(0.3, "#1a3350")
    gripGrad.addColorStop(0.7, "#1a3350"); gripGrad.addColorStop(1, "#0d1a28")
    ctx.fillStyle = gripGrad
    ctx.beginPath()
    ctx.moveTo(gripLeft, handleTop)
    ctx.bezierCurveTo(gripLeft, gripTop - 8, gripLeft + gripW * 0.6, gripTop, gripLeft + gripW, neckTop)
    ctx.lineTo(gripLeft + gripW, neckBot)
    ctx.bezierCurveTo(gripLeft + gripW * 0.6, gripBot, gripLeft, gripBot + 8, gripLeft, handleBot)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "rgba(56,189,248,0.1)"; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gripLeft, handleTop)
    ctx.bezierCurveTo(gripLeft, gripTop - 8, gripLeft + gripW * 0.6, gripTop, gripLeft + gripW, neckTop)
    ctx.lineTo(gripLeft + gripW, neckBot)
    ctx.bezierCurveTo(gripLeft + gripW * 0.6, gripBot, gripLeft, gripBot + 8, gripLeft, handleBot)
    ctx.closePath(); ctx.stroke()

    // Neck
    const neckGrad = ctx.createLinearGradient(gripLeft + gripW, 0, bodyLeft, 0)
    neckGrad.addColorStop(0, "#152840"); neckGrad.addColorStop(1, "#1a2d42")
    ctx.fillStyle = neckGrad
    ctx.beginPath()
    ctx.moveTo(gripLeft + gripW, neckTop); ctx.lineTo(bodyLeft, probeTop + probeH * 0.06)
    ctx.lineTo(bodyLeft, probeBot - probeH * 0.06); ctx.lineTo(gripLeft + gripW, neckBot)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "rgba(56,189,248,0.08)"; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gripLeft + gripW, neckTop); ctx.lineTo(bodyLeft, probeTop + probeH * 0.06)
    ctx.lineTo(bodyLeft, probeBot - probeH * 0.06); ctx.lineTo(gripLeft + gripW, neckBot)
    ctx.closePath(); ctx.stroke()

    // Head
    const bodyGrad = ctx.createLinearGradient(bodyLeft, 0, housingLeft, 0)
    bodyGrad.addColorStop(0, "#14253a"); bodyGrad.addColorStop(0.5, "#1c3450"); bodyGrad.addColorStop(1, "#1a2d42")
    ctx.fillStyle = bodyGrad
    ctx.beginPath()
    ctx.moveTo(bodyLeft, probeTop + probeH * 0.06); ctx.lineTo(housingLeft, headTop)
    ctx.lineTo(housingLeft, headBot); ctx.lineTo(bodyLeft, probeBot - probeH * 0.06)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "rgba(56,189,248,0.1)"; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(bodyLeft, probeTop + probeH * 0.06); ctx.lineTo(housingLeft, headTop)
    ctx.lineTo(housingLeft, headBot); ctx.lineTo(bodyLeft, probeBot - probeH * 0.06)
    ctx.closePath(); ctx.stroke()

    // Housing
    const housingGrad = ctx.createLinearGradient(housingLeft, 0, faceX, 0)
    housingGrad.addColorStop(0, "#1a2d42"); housingGrad.addColorStop(0.5, "#223a52"); housingGrad.addColorStop(1, "#1c3048")
    ctx.fillStyle = housingGrad
    ctx.beginPath(); ctx.roundRect(housingLeft, headTop, PROBE_HOUSING_WIDTH, headBot - headTop, [2, 0, 0, 2]); ctx.fill()
    ctx.strokeStyle = "rgba(56,189,248,0.12)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.roundRect(housingLeft, headTop, PROBE_HOUSING_WIDTH, headBot - headTop, [2, 0, 0, 2]); ctx.stroke()

    // Matching layer
    ctx.fillStyle = "rgba(70,130,170,0.15)"
    ctx.fillRect(faceX - 3, probeTop, 3, probeH)

    // Backing material
    const elementW = PROBE_HOUSING_WIDTH * 0.55
    const backingW = PROBE_HOUSING_WIDTH - elementW
    ctx.fillStyle = "rgba(15,25,35,0.8)"
    ctx.fillRect(housingLeft, probeTop, backingW, probeH)

    // Wiring
    const elementGap = 2.5
    const totalGaps = (NUM_ELEMENTS - 1) * elementGap
    const elementH = (probeH - totalGaps) / NUM_ELEMENTS
    const elementLeft = faceX - elementW
    ctx.strokeStyle = "rgba(56,189,248,0.06)"; ctx.lineWidth = 0.5
    for (let i = 0; i < NUM_ELEMENTS; i += 4) {
      const ey = probeTop + i * (elementH + elementGap) + elementH / 2
      ctx.beginPath(); ctx.moveTo(housingLeft + 4, ey); ctx.lineTo(elementLeft, ey); ctx.stroke()
    }

    // Probe label
    ctx.save()
    ctx.font = "600 11px system-ui, sans-serif"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    const labelX = (gripLeft + bodyLeft) / 2
    const labelY = gripTop - 22
    ctx.strokeStyle = "rgba(56,189,248,0.3)"; ctx.lineWidth = 0.8
    ctx.setLineDash([3, 2])
    ctx.beginPath(); ctx.moveTo(labelX, gripTop - 2); ctx.lineTo(labelX, labelY + 10); ctx.stroke()
    ctx.setLineDash([])
    const probeLabel = "Ultrasound Transducer"
    const plm = ctx.measureText(probeLabel)
    ctx.fillStyle = "rgba(10,8,10,0.9)"
    ctx.beginPath(); ctx.roundRect(labelX - plm.width / 2 - 8, labelY - 11, plm.width + 16, 22, 3); ctx.fill()
    ctx.strokeStyle = "rgba(56,189,248,0.35)"; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.roundRect(labelX - plm.width / 2 - 8, labelY - 11, plm.width + 16, 22, 3); ctx.stroke()
    ctx.fillStyle = "rgba(56,189,248,0.85)"
    ctx.fillText(probeLabel, labelX, labelY)
    ctx.restore()

    staticDirtyRef.current = false
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", { alpha: false })
    if (!ctx) return

    let currentDpr = 1

    const resize = () => {
      currentDpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * currentDpr
      canvas.height = rect.height * currentDpr
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0)

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
      staticDirtyRef.current = true
    }

    resize()
    window.addEventListener("resize", resize)

    const firePulse = () => {
      const s = stateRef.current
      if (!s.initialized) return
      for (const rbc of s.rbcs) { rbc.hit = false; rbc.hitTime = 0 }
      s.echoes = []
      s.pulse = { x: PROBE_FACE_X, opacity: 1, active: true }
      s.elementActivations.fill(0)
      s.hintOpacity = 0
    }

    const onKey = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); firePulse() } }
    const onClick = () => firePulse()
    window.addEventListener("keydown", onKey)
    canvas.addEventListener("click", onClick)
    canvas.addEventListener("touchstart", onClick, { passive: true })

    const animate = (timestamp: number) => {
      const s = stateRef.current
      if (!s.initialized) {
        lastTimeRef.current = timestamp
        animFrameRef.current = requestAnimationFrame(animate)
        return
      }

      const rawDt = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0.016
      const dt = Math.min(rawDt, 0.033)
      lastTimeRef.current = timestamp

      const { w, h } = s.dims
      s.time += dt

      const probeTop = h * PROBE_TOP_FRAC
      const probeBot = h * PROBE_BOT_FRAC
      const probeH = probeBot - probeTop

      // ─── Update ──────────────────────────────────────────────
      for (const rbc of s.rbcs) {
        rbc.t += s.vessels[rbc.vesselIdx].flowSpeed
        if (rbc.t > 1) rbc.t -= 1
        rbc.rotation += rbc.rotSpeed
      }

      if (s.pulse.active) {
        s.pulse.x += WAVE_SPEED
        for (const rbc of s.rbcs) {
          if (rbc.hit) continue
          const pos = getVesselPoint(s.vessels[rbc.vesselIdx], rbc.t)
          if (pos.x >= SKULL_RIGHT + rbc.size && pos.x <= w && pos.y >= 0 && pos.y <= h &&
              pos.y >= probeTop && pos.y <= probeBot && s.pulse.x >= pos.x - rbc.size) {
            rbc.hit = true
            rbc.hitTime = s.time
            if (s.echoes.length < MAX_ECHOES) {
              s.echoes.push({ cx: pos.x, cy: pos.y, radius: rbc.size + 1, opacity: 0.9, birthTime: s.time })
            }
          }
        }
        if (s.pulse.x > w + 20) s.pulse.active = false
      }

      for (let i = s.echoes.length - 1; i >= 0; i--) {
        const e = s.echoes[i]
        e.radius += WAVE_SPEED
        e.opacity = Math.max(0, 0.9 - (s.time - e.birthTime) * 0.12)
        if (e.opacity < 0.02 || e.radius > w * 1.5) {
          s.echoes.splice(i, 1)
        }
      }

      // Element detection
      const elementGap = 2.5
      const totalGaps = (NUM_ELEMENTS - 1) * elementGap
      const elementH = (probeH - totalGaps) / NUM_ELEMENTS

      for (let i = 0; i < NUM_ELEMENTS; i++) {
        s.elementActivations[i] = Math.max(0, s.elementActivations[i] - 0.025)
      }

      for (const echo of s.echoes) {
        if (echo.opacity < 0.05 || echo.cx < PROBE_FACE_X) continue
        const dx = echo.cx - PROBE_FACE_X
        for (let i = 0; i < NUM_ELEMENTS; i++) {
          const eCenterY = probeTop + i * (elementGap + elementH) + elementH / 2
          const dy = echo.cy - eCenterY
          const distToElement = Math.sqrt(dx * dx + dy * dy)
          if (distToElement <= echo.radius && distToElement > echo.radius - WAVE_SPEED) {
            s.elementActivations[i] = Math.min(4, s.elementActivations[i] + 0.6)
          }
        }
      }

      // Fade hint after echoes finish
      if (!s.pulse.active && s.echoes.length === 0 && s.hintOpacity < 1) {
        s.hintOpacity = Math.min(1, s.hintOpacity + dt * 0.4)
      }

      // ─── DRAW ──────────────────────────────────────────────────

      ctx.fillStyle = "#0a0a0f"
      ctx.fillRect(0, 0, w, h)

      // Vessels (no shadowBlur -- just layered strokes)
      for (const vessel of s.vessels) {
        const pts = vessel.points
        const r = vessel.radius

        ctx.lineWidth = r * 2 + 6
        ctx.strokeStyle = "rgba(55,20,28,0.5)"
        ctx.lineCap = "round"; ctx.lineJoin = "round"
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()

        ctx.lineWidth = r * 2 + 3
        ctx.strokeStyle = "rgba(70,28,35,0.6)"
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()

        ctx.lineWidth = r * 2
        ctx.strokeStyle = "rgba(40,10,15,0.85)"
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()
        ctx.lineCap = "butt"; ctx.lineJoin = "miter"
      }

      // Echoes (no shadowBlur -- use double-stroke for glow effect)
      for (const echo of s.echoes) {
        if (echo.cx + echo.radius < 0 || echo.cx - echo.radius > w ||
            echo.cy + echo.radius < 0 || echo.cy - echo.radius > h) continue

        ctx.globalAlpha = echo.opacity * 0.3
        ctx.strokeStyle = "#5ec8fa"
        ctx.lineWidth = 4
        ctx.beginPath(); ctx.arc(echo.cx, echo.cy, echo.radius, 0, Math.PI * 2); ctx.stroke()

        ctx.globalAlpha = echo.opacity * 0.7
        ctx.strokeStyle = "#38bdf8"
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(echo.cx, echo.cy, echo.radius, 0, Math.PI * 2); ctx.stroke()

        ctx.globalAlpha = 1
      }

      // RBCs (no shadowBlur -- use extra circle for glow)
      for (const rbc of s.rbcs) {
        const vessel = s.vessels[rbc.vesselIdx]
        const pos = getVesselPoint(vessel, rbc.t)
        const glowStrength = rbc.hit ? Math.max(0, 1 - (s.time - rbc.hitTime) * 1.2) : 0

        // Check if RBC is behind another vessel
        let behindVessel = false
        for (let vi = 0; vi < s.vessels.length; vi++) {
          if (vi === rbc.vesselIdx) continue
          const v = s.vessels[vi]
          const rSq = (v.radius + 3) * (v.radius + 3)
          for (let j = 0; j < v.points.length - 1; j++) {
            if (ptSegDistSq(pos.x, pos.y, v.points[j].x, v.points[j].y, v.points[j + 1].x, v.points[j + 1].y) < rSq) {
              behindVessel = true
              break
            }
          }
          if (behindVessel) break
        }
        const dimFactor = behindVessel ? 0.3 : 1

        ctx.save()
        ctx.globalAlpha = dimFactor
        ctx.translate(pos.x, pos.y)
        ctx.rotate(pos.angle + rbc.rotation)

        const r = rbc.size

        // Glow ring instead of shadowBlur
        if (glowStrength > 0.1) {
          ctx.globalAlpha = glowStrength * 0.4 * dimFactor
          ctx.fillStyle = "#ff4444"
          ctx.beginPath(); ctx.ellipse(0, 0, r + 4, (r + 4) * 0.5, 0, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = dimFactor
        }

        const isGlowing = glowStrength > 0.1
        ctx.fillStyle = isGlowing ? "#dd3333" : "#a01818"
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill()

        // Highlight edge
        ctx.fillStyle = isGlowing ? "rgba(255,120,120,0.3)" : "rgba(180,50,50,0.3)"
        ctx.beginPath(); ctx.ellipse(-r * 0.15, -r * 0.08, r * 0.7, r * 0.3, -0.1, Math.PI, Math.PI * 2); ctx.fill()

        // Dimple
        ctx.fillStyle = isGlowing ? "rgba(90,12,12,0.5)" : "rgba(50,6,6,0.55)"
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.32, r * 0.2, 0, 0, Math.PI * 2); ctx.fill()

        ctx.restore()

        // RBC label
        if (rbc.labeled) {
          ctx.save()
          ctx.globalAlpha = dimFactor
          ctx.font = "600 11px system-ui, sans-serif"
          ctx.fillStyle = "rgba(255,100,100,0.9)"
          ctx.textAlign = "left"; ctx.textBaseline = "middle"
          const lx = pos.x + rbc.size + 6
          const ly = pos.y - rbc.size - 6

          ctx.strokeStyle = "rgba(255,100,100,0.4)"; ctx.lineWidth = 0.8
          ctx.setLineDash([3, 2])
          ctx.beginPath(); ctx.moveTo(pos.x + rbc.size + 1, pos.y); ctx.lineTo(lx, ly); ctx.stroke()
          ctx.setLineDash([])

          const text = "Red Blood Cell"
          const tm = ctx.measureText(text)
          ctx.fillStyle = "rgba(10,8,10,0.9)"
          ctx.beginPath(); ctx.roundRect(lx - 5, ly - 10, tm.width + 10, 20, 3); ctx.fill()
          ctx.strokeStyle = "rgba(255,100,100,0.5)"; ctx.lineWidth = 0.8
          ctx.beginPath(); ctx.roundRect(lx - 5, ly - 10, tm.width + 10, 20, 3); ctx.stroke()
          ctx.fillStyle = "rgba(255,100,100,0.9)"
          ctx.fillText(text, lx, ly)
          ctx.restore()
        }
      }

      // Pulse wavefront (no shadowBlur -- use double-stroke)
      if (s.pulse.active && s.pulse.x > PROBE_FACE_X) {
        ctx.globalAlpha = s.pulse.opacity * 0.3
        ctx.strokeStyle = "#38bdf8"
        ctx.lineWidth = PULSE_WIDTH + 8
        ctx.beginPath(); ctx.moveTo(s.pulse.x, probeTop); ctx.lineTo(s.pulse.x, probeBot); ctx.stroke()

        ctx.globalAlpha = s.pulse.opacity
        ctx.strokeStyle = "#38bdf8"
        ctx.lineWidth = PULSE_WIDTH
        ctx.beginPath(); ctx.moveTo(s.pulse.x, probeTop); ctx.lineTo(s.pulse.x, probeBot); ctx.stroke()

        ctx.globalAlpha = 1
      }

      // ─── Static layer (skull + probe body) from offscreen canvas ──
      if (staticDirtyRef.current) {
        renderStatic(w, h, currentDpr)
      }
      if (staticCanvasRef.current) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(staticCanvasRef.current, 0, 0)
        ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0)
        ctx.restore()
      }

      // ─── Dynamic elements on top of static probe ──────────────
      const faceX = PROBE_FACE_X
      const elementW = PROBE_HOUSING_WIDTH * 0.55
      const elementLeft = faceX - elementW

      for (let i = 0; i < NUM_ELEMENTS; i++) {
        const ey = probeTop + i * (elementH + elementGap)
        const transmitting = s.pulse.active && s.pulse.x < faceX + 30 && s.pulse.x >= faceX - 5
        const receiveGlow = s.elementActivations[i]

        // Separator
        if (i > 0) {
          ctx.fillStyle = "#080d14"
          ctx.fillRect(elementLeft - 1, ey - elementGap, elementW + 2, elementGap)
        }

        // Element fill
        if (transmitting) {
          ctx.fillStyle = "rgba(56,189,248,0.65)"
        } else if (receiveGlow > 0.05) {
          const intensity = Math.min(receiveGlow / 4, 1)
          const r = Math.round(100 + intensity * 155)
          const g = Math.round(180 + intensity * 75)
          const a = Math.min(0.3 + Math.min(receiveGlow, 1) * 0.4 + intensity * 0.25, 1)
          ctx.fillStyle = `rgba(${r},${g},255,${a})`
        } else {
          ctx.fillStyle = "rgba(45,80,115,0.55)"
        }
        ctx.fillRect(elementLeft, ey, elementW, elementH)

        // Element border
        if (transmitting) {
          ctx.strokeStyle = "rgba(56,189,248,0.7)"
        } else if (receiveGlow > 0.05) {
          const intensity = Math.min(receiveGlow / 4, 1)
          ctx.strokeStyle = `rgba(${Math.round(120 + intensity * 135)},${Math.round(200 + intensity * 55)},255,${Math.min(0.25 + receiveGlow * 0.25, 1)})`
        } else {
          ctx.strokeStyle = "rgba(56,189,248,0.25)"
        }
        ctx.lineWidth = 0.8
        ctx.strokeRect(elementLeft, ey, elementW, elementH)
      }

      // Face edge glow per-element
      const isTransmitting = s.pulse.active && s.pulse.x < faceX + 30
      if (isTransmitting) {
        ctx.fillStyle = "rgba(56,189,248,0.8)"
        ctx.fillRect(faceX - 1.5, probeTop, 1.5, probeH)
      } else {
        for (let i = 0; i < NUM_ELEMENTS; i++) {
          const ey = probeTop + i * (elementH + elementGap)
          const rg = s.elementActivations[i]
          if (rg > 0.05) {
            const fi = Math.min(rg / 4, 1)
            ctx.fillStyle = `rgba(${Math.round(100 + fi * 155)},${Math.round(190 + fi * 65)},255,${Math.min(0.25 + rg * 0.25, 1)})`
          } else {
            ctx.fillStyle = "rgba(56,189,248,0.25)"
          }
          ctx.fillRect(faceX - 1.5, ey, 1.5, elementH)
        }
      }

      // Subtle interaction hint
      if (s.hintOpacity > 0.01) {
        ctx.save()
        ctx.globalAlpha = s.hintOpacity * 0.45
        ctx.font = "400 13px system-ui, sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "bottom"
        ctx.fillStyle = "#94a3b8"
        ctx.fillText("Space / tap to pulse", w / 2, h - 16)
        ctx.restore()
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener("keydown", onKey)
      canvas.removeEventListener("click", onClick)
      canvas.removeEventListener("touchstart", onClick)
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [buildVessels, buildRBCs, renderStatic])

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
