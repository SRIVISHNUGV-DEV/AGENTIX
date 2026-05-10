'use client'

import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox, Float, MeshTransmissionMaterial } from '@react-three/drei'
import * as THREE from 'three'

interface Card3DProps {
  children?: React.ReactNode
  className?: string
}

function GlassCard() {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.1
      meshRef.current.rotation.y = Math.cos(state.clock.elapsedTime * 0.3) * 0.1
    }
  })

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
      <RoundedBox ref={meshRef} args={[2, 2.5, 0.1]} radius={0.1} smoothness={4}>
        <MeshTransmissionMaterial
          backside
          samples={4}
          thickness={0.5}
          chromaticAberration={0.025}
          anisotropy={0.1}
          distortion={0.1}
          distortionScale={0.1}
          temporalDistortion={0.2}
          iridescence={1}
          iridescenceIOR={1}
          iridescenceThicknessRange={[0, 1400]}
          color="#ffffff"
          transmission={0.95}
          roughness={0.1}
          metalness={0.1}
        />
      </RoundedBox>
    </Float>
  )
}

export default function Card3D({ className = '' }: Card3DProps) {
  return (
    <div className={`relative w-64 h-80 ${className}`}>
      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[5, 5, 5]} intensity={1} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} color="#888888" />
        <GlassCard />
      </Canvas>
    </div>
  )
}
