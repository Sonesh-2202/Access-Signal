import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import type { FeatureStatus } from '@/types'
import { prefersReducedMotion } from '@/utils/webgl'

const C = { paper: '#F8F6F1', sunk: '#EFECE6', tint: '#D9CBA9', ink: '#1A1917', muted: '#8C867B', signal: '#B83A24' }

const statusColor = (s: FeatureStatus | undefined) =>
  s === 'unavailable' ? C.signal : s === 'limited' ? C.muted : s === 'available' ? C.ink : C.tint

/** A pin standing above the feature. Height encodes nothing; it only lifts the marker clear of the geometry. */
function Pin({ position, status }: { position: [number, number, number]; status?: FeatureStatus }) {
  const color = statusColor(status)
  return (
    <group position={position}>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        {status === 'unavailable' ? <octahedronGeometry args={[0.18]} /> : <sphereGeometry args={[0.15, 20, 20]} />}
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

function Scene({ features, dragging }: { features: Record<string, FeatureStatus>; dragging: React.MutableRefObject<{ dx: number }> }) {
  const g = useRef<Group>(null)
  const still = useMemo(() => prefersReducedMotion(), [])
  useFrame((_, dt) => {
    if (!g.current) return
    g.current.rotation.y += dragging.current.dx * 0.01
    dragging.current.dx *= 0.85
    if (!still && Math.abs(dragging.current.dx) < 0.01) g.current.rotation.y += dt * 0.08
  })
  const hasRamp = 'ramp' in features
  const hasElevator = 'elevator' in features
  return (
    <group ref={g} rotation={[0, -0.5, 0]}>
      {/* sidewalk */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.6]}>
        <planeGeometry args={[7, 3.2]} />
        <meshStandardMaterial color={C.sunk} />
      </mesh>
      {/* curb */}
      <mesh position={[0, -0.06, 2.25]}>
        <boxGeometry args={[7, 0.12, 0.1]} />
        <meshStandardMaterial color={C.tint} />
      </mesh>
      {/* building mass */}
      <mesh position={[0, 1.6, -1.6]}>
        <boxGeometry args={[6, 3.2, 1.6]} />
        <meshStandardMaterial color={C.paper} />
      </mesh>
      {/* door recess */}
      <mesh position={[0, 0.85, -0.79]}>
        <boxGeometry args={[1.1, 1.7, 0.04]} />
        <meshStandardMaterial color={statusColor(features.step_free_entrance ?? features.automatic_door)} />
      </mesh>
      {/* raised floor + steps */}
      <mesh position={[0, 0.09, -0.55]}>
        <boxGeometry args={[1.8, 0.18, 0.5]} />
        <meshStandardMaterial color={C.tint} />
      </mesh>
      {/* ramp alongside the steps */}
      {hasRamp && (
        <mesh position={[1.9, 0.09, -0.35]} rotation={[0, 0, 0.09]}>
          <boxGeometry args={[2.0, 0.04, 0.8]} />
          <meshStandardMaterial color={statusColor(features.ramp)} />
        </mesh>
      )}
      {hasElevator && (
        <mesh position={[-2.2, 1.4, -0.65]}>
          <boxGeometry args={[0.9, 2.8, 0.3]} />
          <meshStandardMaterial color={statusColor(features.elevator)} transparent opacity={0.85} />
        </mesh>
      )}
      <Pin position={[0, 1.8, -0.7]} status={features.step_free_entrance} />
      {hasRamp && <Pin position={[2.4, 0.2, -0.35]} status={features.ramp} />}
      {hasElevator && <Pin position={[-2.2, 2.8, -0.5]} status={features.elevator} />}
    </group>
  )
}

/** Schematic model of a building frontage. Decorative: the feature list beside it carries the same information. */
export default function EntranceModel3D({ features }: { features: Record<string, FeatureStatus> }) {
  const dragging = useRef({ dx: 0 })
  const [down, setDown] = useState<number | null>(null)
  return (
    <div
      className="h-full w-full cursor-grab active:cursor-grabbing"
      aria-hidden
      onPointerDown={(e) => setDown(e.clientX)}
      onPointerMove={(e) => {
        if (down === null) return
        dragging.current.dx = (e.clientX - down) * 0.3
        setDown(e.clientX)
      }}
      onPointerUp={() => setDown(null)}
      onPointerLeave={() => setDown(null)}
    >
      <Canvas camera={{ position: [0, 4.2, 10.5], fov: 36 }} onCreated={({ camera }) => camera.lookAt(0, 0.9, -0.6)} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={[C.paper]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <Scene features={features} dragging={dragging} />
      </Canvas>
    </div>
  )
}
