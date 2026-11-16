import { Edges, Html, Line, OrthographicCamera } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Line2 } from 'three-stdlib'
import { cx } from '@/utils/cx'
import { BARRIER, polyLength, STANDARD_PTS, STEPFREE_PTS, type HeroRouteMode, type P2 } from './heroGeometry'

/**
 * Isometric model of a Manhattan intersection: an avenue running north–south, a cross
 * street, four corner blocks, a subway entrance and the curb cuts at each crossing.
 *
 * Two routes run from A (north-west) to B (north-east). The standard route crosses the
 * avenue straight to the north-east corner, where the subway elevator is out. The
 * step-free route goes south across the street, along the plaza and back north at a
 * mid-block crossing with a verified ramp.
 *
 * Decorative: <HeroVisual/> renders the same facts as text for assistive technology.
 */


const C = {
  asphalt: '#34322F',
  asphaltSide: '#2A2826',
  lane: '#8E887D',
  sidewalk: '#E5E0D8',
  curb: '#CFC8BC',
  bars: '#F1EEE8',
  buildings: ['#F3F0EA', '#ECE7DF', '#E2DCD1', '#D8D0C3'],
  ink: '#1A1917',
  signal: '#B83A24',
  ok: '#1F6E43',
  okGlow: '#3FA56C',
  warn: '#D97706',
  tactile: '#D9CBA9',
  paper: '#F8F6F1',
}

const ROUTE_Y = 0.42
const AVE = 1.7 // avenue half-width (x)
const ST = 1.3 // street half-width (z)
const EDGE = 9.2 // half-size of the model


function roundedPath(pts: P2[], r = 0.55) {
  const v = pts.map(([x, z]) => new THREE.Vector3(x, ROUTE_Y, z))
  const path = new THREE.CurvePath<THREE.Vector3>()
  let cur = v[0].clone()
  for (let i = 1; i < v.length - 1; i++) {
    const [a, b, c] = [v[i - 1], v[i], v[i + 1]]
    const p1 = b.clone().add(a.clone().sub(b).setLength(Math.min(r, a.distanceTo(b) / 2)))
    const p2 = b.clone().add(c.clone().sub(b).setLength(Math.min(r, b.distanceTo(c) / 2)))
    path.add(new THREE.LineCurve3(cur, p1))
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2))
    cur = p2
  }
  path.add(new THREE.LineCurve3(cur, v[v.length - 1]))
  return path
}

/* ------------------------------------------------------------------ static city */

function Hairline({ opacity = 0.28 }: { opacity?: number }) {
  return <Edges threshold={20} color={C.ink} transparent opacity={opacity} />
}

function Box({ pos, size, color, edges = 0.28, shadow = true, children }: { pos: [number, number, number]; size: [number, number, number]; color: string; edges?: number; shadow?: boolean; children?: ReactNode }) {
  return (
    <mesh position={pos} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.92} metalness={0} />
      {edges > 0 && <Hairline opacity={edges} />}
      {children}
    </mesh>
  )
}

const H_WALK = 0.16

function Ground() {
  const quads: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
  return (
    <group>
      {/* Asphalt plinth, cut like an architect's model. */}
      <Box pos={[0, -0.35, 0]} size={[EDGE * 2, 0.7, EDGE * 2]} color={C.asphalt} edges={0.5} shadow={false} />
      {quads.map(([sx, sz]) => (
        <Box
          key={`${sx}${sz}`}
          pos={[(sx * (AVE + EDGE)) / 2, H_WALK / 2, (sz * (ST + EDGE)) / 2]}
          size={[EDGE - AVE, H_WALK, EDGE - ST]}
          color={C.sidewalk}
          edges={0.18}
          shadow={false}
        />
      ))}
      {/* Lane lines: avenue (along z) and street (along x), stopped short of the crossings. */}
      {[-8.4, -7.2, -6.0, -4.0, -2.8, 2.8, 4.0, 5.2, 6.4, 7.6].map((z) => (
        <mesh key={`a${z}`} position={[0, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.07, 0.6]} />
          <meshBasicMaterial color={C.lane} />
        </mesh>
      ))}
      {[-8.2, -7.0, -5.8, -4.6, -3.4, 3.4, 6.6, 7.8].map((x) => (
        <mesh key={`s${x}`} position={[x, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 0.07]} />
          <meshBasicMaterial color={C.lane} />
        </mesh>
      ))}
    </group>
  )
}

/** Ladder crosswalk. `across` is the direction people walk. */
function Crosswalk({ at, across, span }: { at: P2; across: 'x' | 'z'; span: number }) {
  const n = Math.floor(span / 0.42)
  return (
    <group position={[at[0], 0.008, at[1]]}>
      {Array.from({ length: n }, (_, i) => {
        const o = -span / 2 + 0.21 + i * 0.42
        return (
          <mesh key={i} position={across === 'x' ? [o, 0, 0] : [0, 0, o]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={across === 'x' ? [0.24, 0.95] : [0.95, 0.24]} />
            <meshBasicMaterial color={C.bars} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Curb ramp: a lowered strip of curb with a tactile pad at the street edge. */
function CurbRamp({ at, facing, tone }: { at: P2; facing: 'x+' | 'x-' | 'z+' | 'z-'; tone?: string }) {
  const rotY = { 'x+': -Math.PI / 2, 'x-': Math.PI / 2, 'z+': 0, 'z-': Math.PI }[facing]
  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, rotY, 0]}>
      <mesh position={[0, H_WALK / 2 + 0.002, -0.1]} rotation={[-0.32, 0, 0]} receiveShadow>
        <boxGeometry args={[0.95, 0.04, 0.5]} />
        <meshStandardMaterial color={C.curb} roughness={1} />
      </mesh>
      <mesh position={[0, 0.03, 0.17]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.9, 0.18]} />
        <meshStandardMaterial color={tone ?? C.tactile} roughness={1} emissive={tone ?? '#000'} emissiveIntensity={tone ? 0.25 : 0} />
      </mesh>
    </group>
  )
}

const BUILDINGS: { x: [number, number]; z: [number, number]; h: number; c: number }[] = [
  // north-west: tallest, at the back of the view
  { x: [-8.7, -5.7], z: [-8.7, -2.45], h: 4.4, c: 1 },
  { x: [-5.5, -2.85], z: [-5.1, -2.45], h: 2.6, c: 0 },
  { x: [-5.5, -2.85], z: [-8.7, -5.3], h: 5.2, c: 2 },
  // north-east
  { x: [2.85, 5.6], z: [-8.7, -2.45], h: 3.4, c: 2 },
  { x: [5.8, 8.7], z: [-5.9, -2.45], h: 2.2, c: 0 },
  { x: [5.8, 8.7], z: [-8.7, -6.1], h: 4.0, c: 3 },
  // south-west
  { x: [-8.7, -5.3], z: [2.45, 8.7], h: 1.9, c: 3 },
  { x: [-5.1, -2.85], z: [2.45, 5.5], h: 1.4, c: 1 },
  { x: [-5.1, -2.85], z: [5.7, 8.7], h: 1.0, c: 0 },
  // south-east: low, nearest the camera, so it never hides the crossings
  { x: [2.85, 4.5], z: [3.4, 8.7], h: 0.7, c: 0 },
  { x: [6.0, 8.7], z: [2.45, 8.7], h: 1.1, c: 2 },
]

function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b, i) => {
        const w = b.x[1] - b.x[0]
        const d = b.z[1] - b.z[0]
        return (
          <group key={i}>
            <Box pos={[(b.x[0] + b.x[1]) / 2, H_WALK + b.h / 2, (b.z[0] + b.z[1]) / 2]} size={[w, b.h, d]} color={C.buildings[b.c]} edges={0.3} />
            {/* Cornice line: a hint of floors without texture noise. */}
            {b.h > 2 && <Box pos={[(b.x[0] + b.x[1]) / 2, H_WALK + b.h + 0.06, (b.z[0] + b.z[1]) / 2]} size={[w + 0.12, 0.12, d + 0.12]} color={C.buildings[Math.min(3, b.c + 1)]} edges={0.22} />}
          </group>
        )
      })}
    </group>
  )
}

function SubwayEntrance({ outage }: { outage: boolean }) {
  const glass = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (glass.current) glass.current.emissiveIntensity = outage ? 0.35 + Math.sin(clock.elapsedTime * 3) * 0.15 : 0.05
  })
  const y = H_WALK
  return (
    <group position={[3.75, y, -1.95]}>
      {/* stair well */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.25, 0.62]} />
        <meshBasicMaterial color={C.asphaltSide} />
      </mesh>
      {/* railings */}
      {[-0.33, 0.33].map((z) => (
        <Box key={z} pos={[0, 0.28, z]} size={[1.3, 0.04, 0.04]} color={C.ink} edges={0} shadow={false} />
      ))}
      <Box pos={[0.64, 0.28, 0]} size={[0.04, 0.04, 0.7]} color={C.ink} edges={0} shadow={false} />
      {[-0.6, 0.6].flatMap((x) => [-0.33, 0.33].map((z) => <Box key={`${x}${z}`} pos={[x, 0.14, z]} size={[0.035, 0.28, 0.035]} color={C.ink} edges={0} shadow={false} />))}
      {/* MTA globe lamps */}
      {[-0.6, 0.6].map((x) => (
        <group key={x} position={[x, 0, -0.38]}>
          <Box pos={[0, 0.3, 0]} size={[0.035, 0.6, 0.035]} color={C.ink} edges={0} shadow={false} />
          <mesh position={[0, 0.66, 0]}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshStandardMaterial color={C.ok} emissive={C.okGlow} emissiveIntensity={0.7} />
          </mesh>
        </group>
      ))}
      {/* street elevator, the reported outage */}
      <mesh position={[-1.25, 0.62, -0.05]} castShadow>
        <boxGeometry args={[0.55, 1.24, 0.55]} />
        <meshStandardMaterial ref={glass} color={outage ? '#E9C4BA' : '#DCE6E0'} emissive={C.signal} transparent opacity={0.72} roughness={0.2} />
        <Hairline opacity={0.55} />
      </mesh>
    </group>
  )
}

function Cones({ at }: { at: P2 }) {
  return (
    <group position={[at[0], H_WALK, at[1]]}>
      {[[-0.38, 0], [0.38, 0], [0, -0.32]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.17, 0]} castShadow>
            <coneGeometry args={[0.1, 0.34, 14]} />
            <meshStandardMaterial color={C.warn} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.062, 0.072, 0.05, 14]} />
            <meshStandardMaterial color={C.paper} />
          </mesh>
        </group>
      ))}
      {/* plated trench */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.9, 0.5]} />
        <meshStandardMaterial color="#6E6A63" metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  )
}

function City({ mode }: { mode: HeroRouteMode }) {
  return (
    <group>
      <Ground />
      {/* crossings at the intersection */}
      <Crosswalk at={[0, -1.9]} across="x" span={AVE * 2 - 0.3} />
      <Crosswalk at={[0, 1.9]} across="x" span={AVE * 2 - 0.3} />
      <Crosswalk at={[-2.25, 0]} across="z" span={ST * 2 - 0.3} />
      <Crosswalk at={[2.25, 0]} across="z" span={ST * 2 - 0.3} />
      {/* mid-block crossing east of the avenue */}
      <Crosswalk at={[5.2, 0]} across="z" span={ST * 2 - 0.3} />
      <CurbRamp at={[-AVE - 0.25, -1.9]} facing="x+" />
      <CurbRamp at={[AVE + 0.25, -1.9]} facing="x-" tone={mode === 'standard' ? C.signal : undefined} />
      <CurbRamp at={[-AVE - 0.25, 1.9]} facing="x+" />
      <CurbRamp at={[AVE + 0.25, 1.9]} facing="x-" />
      <CurbRamp at={[-2.25, -ST - 0.25]} facing="z+" />
      <CurbRamp at={[-2.25, ST + 0.25]} facing="z-" />
      <CurbRamp at={[2.25, ST + 0.25]} facing="z-" tone={C.warn} />
      <CurbRamp at={[5.2, ST + 0.25]} facing="z-" tone={C.ok} />
      <CurbRamp at={[5.2, -ST - 0.25]} facing="z+" tone={C.ok} />
      <Buildings />
      <SubwayEntrance outage />
      <Cones at={[2.25, 2.1]} />
    </group>
  )
}

/* ------------------------------------------------------------------ routes */

function StepFreeTube({ curve, active }: { curve: THREE.CurvePath<THREE.Vector3>; active: boolean }) {
  const SEG = 260
  const RAD = 10
  const [core, halo] = useMemo(() => [new THREE.TubeGeometry(curve, SEG, 0.12, RAD), new THREE.TubeGeometry(curve, SEG, 0.26, RAD)], [curve])
  const progress = useRef(0)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => () => {
    core.dispose()
    halo.dispose()
  }, [core, halo])

  useFrame(({ clock }, dt) => {
    // Draw on over 1.3 s, retract in 0.35 s: leaving should feel quicker than arriving.
    const step = active ? dt / 1.3 : -dt / 0.35
    progress.current = still ? (active ? 1 : 0) : THREE.MathUtils.clamp(progress.current + step, 0, 1)
    const eased = 1 - Math.pow(1 - progress.current, 3)
    const n = core.index!.count
    const tris = Math.floor((eased * n) / 6) * 6
    core.setDrawRange(0, tris)
    halo.setDrawRange(0, tris)
    if (haloMat.current) haloMat.current.opacity = (0.16 + Math.sin(clock.elapsedTime * 2.2) * 0.05) * Math.min(1, eased * 3)
  })

  return (
    <group>
      <mesh geometry={halo} renderOrder={2}>
        <meshBasicMaterial ref={haloMat} color={C.okGlow} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh geometry={core} castShadow renderOrder={3}>
        <meshStandardMaterial color={C.ok} emissive={C.okGlow} emissiveIntensity={0.55} roughness={0.35} />
      </mesh>
    </group>
  )
}

function BlockedLine({ points, active }: { points: THREE.Vector3[]; active: boolean }) {
  const ref = useRef<Line2>(null)
  useFrame((_, dt) => {
    const m = ref.current?.material
    if (!m) return
    m.dashOffset -= dt * 0.9
    m.opacity = THREE.MathUtils.damp(m.opacity, active ? 1 : 0.32, 6, dt)
  })
  return <Line ref={ref} points={points} color={C.signal} lineWidth={3} dashed dashSize={0.32} gapSize={0.2} transparent opacity={1} renderOrder={4} />
}

function BarrierRing({ at }: { at: P2 }) {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime % 1.8) / 1.8
    ref.current?.scale.setScalar(1 + t * 2.4)
    if (mat.current) mat.current.opacity = 0.55 * (1 - t)
  })
  return (
    <mesh ref={ref} position={[at[0], H_WALK + 0.02, at[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.28, 0.36, 40]} />
      <meshBasicMaterial ref={mat} color={C.signal} transparent depthWrite={false} />
    </mesh>
  )
}

/** The traveller. Walks the active route; on the standard route it stops at the barrier. */
function Traveller({ standard, stepFree, mode }: { standard: THREE.CurvePath<THREE.Vector3>; stepFree: THREE.CurvePath<THREE.Vector3>; mode: HeroRouteMode }) {
  const ref = useRef<THREE.Group>(null)
  const t = useRef(0)
  const hold = useRef(0)
  const restart = useRef(false)
  const stopAt = useMemo(() => (polyLength([STANDARD_PTS[0], STANDARD_PTS[1], [BARRIER[0] - 0.55, BARRIER[1]]])) / polyLength(STANDARD_PTS), [])
  const lenStd = useMemo(() => standard.getLength(), [standard])
  const lenFree = useMemo(() => stepFree.getLength(), [stepFree])
  useEffect(() => {
    t.current = 0
    restart.current = false
    hold.current = mode === 'stepfree' ? 0.9 : 0.3 // let the line start drawing first
  }, [mode])
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const curve = mode === 'standard' ? standard : stepFree
    const end = mode === 'standard' ? stopAt : 1
    if (hold.current > 0) hold.current -= dt
    else if (restart.current) {
      // Pause is over: start again from A.
      restart.current = false
      t.current = 0
    } else {
      t.current += (dt * 2.6) / (mode === 'standard' ? lenStd : lenFree)
      if (t.current >= end) {
        t.current = end
        hold.current = mode === 'standard' ? 1.4 : 1.0
        restart.current = true
      }
    }
    const p = curve.getPointAt(Math.min(1, Math.max(0, t.current)))
    g.position.set(p.x, p.y + 0.06, p.z)
  })
  return (
    <group ref={ref}>
      <mesh castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.12, 24]} />
        <meshStandardMaterial color={C.ink} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.065, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.01, 24]} />
        <meshBasicMaterial color={C.paper} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ pins */

type Tone = 'signal' | 'ok' | 'warn'
const TONE: Record<Tone, { ring: string; text: string; bg: string }> = {
  signal: { ring: 'border-signal/50', text: 'text-signal-deep', bg: 'bg-signal' },
  ok: { ring: 'border-ok/45', text: 'text-ok', bg: 'bg-ok' },
  warn: { ring: 'border-warn/60', text: 'text-warn-deep', bg: 'bg-warn' },
}

function Glyph({ tone }: { tone: Tone }) {
  const d =
    tone === 'signal'
      ? 'M10 3 18 16.5H2Z M10 8v4 M10 14.25v.25'
      : tone === 'ok'
        ? 'm4.5 10.5 3.5 3.5 7.5-8'
        : 'M12.6 3.4a3.6 3.6 0 0 0-3.9 4.9L3.5 13.5l3 3 5.2-5.2a3.6 3.6 0 0 0 4.9-3.9l-2.3 2.3-2.4-.6-.6-2.4Z'
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function Pin({ at, lift, tone, title, meta, badge, align = 'center' }: { at: P2; lift: number; tone: Tone; title: string; meta: string; badge?: string; align?: 'center' | 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const t = TONE[tone]
  return (
    <Html position={[at[0], H_WALK, at[1]]} zIndexRange={[30, 10]} style={{ pointerEvents: 'none' }}>
      <div
        className="flex flex-col items-center"
        style={{ transform: `translate(${align === 'center' ? '-50%' : align === 'left' ? '-14%' : '-86%'}, -100%)` }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={() => setOpen(false)}
          onClick={() => setOpen((o) => !o)}
          className={cx(
            'pointer-events-auto flex flex-col items-start whitespace-nowrap rounded-md border bg-paper-raised/95 px-1 py-0.5 text-left shadow-[0_1px_0_rgba(26,25,23,0.05),0_8px_20px_-10px_rgba(26,25,23,0.45)] backdrop-blur-[2px] transition-transform duration-150 ease-out active:scale-[0.97]',
            t.ring,
          )}
        >
          <span className={cx('flex items-center gap-[6px] text-[12px] font-medium leading-[18px]', t.text)}>
            <Glyph tone={tone} />
            <span className="text-ink">{title}</span>
            {badge && <span className={cx('rounded-sm px-[5px] font-mono text-[10px] uppercase leading-[16px] tracking-[0.06em] text-paper', t.bg)}>{badge}</span>}
          </span>
          <span className={cx('grid transition-[grid-template-rows,opacity] duration-200 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
            <span className="tabular overflow-hidden font-mono text-[10.5px] leading-[16px] text-muted">{meta}</span>
          </span>
        </button>
        <span className="w-px bg-ink/40" style={{ height: lift }} />
        <span className={cx('h-[7px] w-[7px] rounded-full ring-2 ring-paper', t.bg)} />
      </div>
    </Html>
  )
}

function EndMarker({ at, letter }: { at: P2; letter: string }) {
  return (
    <Html position={[at[0], ROUTE_Y, at[1]]} center zIndexRange={[25, 10]} style={{ pointerEvents: 'none' }}>
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-sm border-2 border-paper bg-ink font-mono text-[11px] font-semibold text-paper shadow-sm">{letter}</span>
    </Html>
  )
}

/* ------------------------------------------------------------------ camera */

function CameraRig({ parallax }: { parallax: boolean }) {
  const { camera, size, pointer } = useThree()
  const target = useMemo(() => new THREE.Vector3(0.6, 0.6, 0.2), [])
  const base = useMemo(() => ({ az: Math.PI / 4, el: 0.62, r: 40 }), [])
  const cur = useRef({ az: base.az, el: base.el })

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera
    cam.zoom = Math.min(size.width / 24, size.height / 16.5)
    cam.updateProjectionMatrix()
  }, [camera, size])

  useFrame((_, dt) => {
    const az = base.az + (parallax ? pointer.x * 0.16 : 0)
    const el = base.el + (parallax ? pointer.y * 0.07 : 0)
    cur.current.az = THREE.MathUtils.damp(cur.current.az, az, 3.2, dt)
    cur.current.el = THREE.MathUtils.damp(cur.current.el, el, 3.2, dt)
    const { r } = base
    camera.position.set(
      target.x + r * Math.cos(cur.current.el) * Math.sin(cur.current.az),
      target.y + r * Math.sin(cur.current.el),
      target.z + r * Math.cos(cur.current.el) * Math.cos(cur.current.az),
    )
    camera.lookAt(target)
  })
  return null
}

/* ------------------------------------------------------------------ root */

export default function HeroCityScene({ mode, running }: { mode: HeroRouteMode; running: boolean }) {
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const standard = useMemo(() => roundedPath(STANDARD_PTS, 0.01), [])
  const stepFree = useMemo(() => roundedPath(STEPFREE_PTS), [])
  const dashedPts = useMemo(() => standard.getSpacedPoints(80), [standard])

  return (
    <Canvas
      shadows="soft"
      flat
      dpr={[1, 2]}
      frameloop={running ? 'always' : 'never'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden
    >
      <OrthographicCamera makeDefault position={[28, 25, 28]} near={-200} far={400} />
      <CameraRig parallax={!still} />
      <hemisphereLight args={['#FFFDF8', '#D6CFC4', 1.6]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[-9, 18, 7]}
        intensity={1.6}
        color="#FFF4E6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0004}
      />
      <City mode={mode} />
      <BlockedLine points={dashedPts} active={mode === 'standard'} />
      <StepFreeTube curve={stepFree} active={mode === 'stepfree'} />
      {mode === 'standard' && <BarrierRing at={BARRIER} />}
      {!still && <Traveller standard={standard} stepFree={stepFree} mode={mode} />}

      <EndMarker at={STANDARD_PTS[0]} letter="A" />
      <EndMarker at={STANDARD_PTS[STANDARD_PTS.length - 1]} letter="B" />
      <Pin
        at={[3.0, -2.0]}
        lift={74}
        tone="signal"
        align="left"
        title="Elevator Outage · 14th St"
        meta="EL204 · reported 3 h ago · 4 confirmations"
        badge={mode === 'standard' ? 'Blocks route' : 'Avoided'}
      />
      <Pin at={[5.2, 1.65]} lift={30} tone="ok" align="left" title="Ramp Verified · Broadway" meta="Checked 52 min ago · slope 1:14" />
      <Pin at={[2.25, 2.2]} lift={44} tone="warn" align="right" title="Curb Cut Under Repair" meta="DOT crew on site · est. 2 days" />
    </Canvas>
  )
}
