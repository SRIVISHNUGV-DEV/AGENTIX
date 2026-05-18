'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, MeshDistortMaterial, Sphere, Box, Torus } from '@react-three/drei'
import * as THREE from 'three'

function AnimatedSphere() {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.2
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.3
    }
  })

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <Sphere ref={meshRef} args={[1, 64, 64]}>
        <MeshDistortMaterial
          color="#ffffff"
          attach="material"
          distort={0.3}
          speed={2}
          roughness={0.2}
          metalness={0.8}
        />
      </Sphere>
    </Float>
  )
}

function OrbitingRings() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.1
    }
  })

  return (
    <group ref={groupRef}>
      <Torus args={[1.8, 0.02, 16, 100]} position={[0, 0, 0]}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
      </Torus>
      <Torus args={[2.2, 0.02, 16, 100]} rotation={[Math.PI / 3, 0, 0]}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.2} />
      </Torus>
      <Torus args={[2.6, 0.02, 16, 100]} rotation={[Math.PI / 4, Math.PI / 6, 0]}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.15} />
      </Torus>
    </group>
  )
}

function FloatingParticles() {
  const particles = useMemo(() => {
    const temp = []
    for (let i = 0; i < 50; i++) {
      temp.push({
        position: [
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
        ],
        scale: Math.random() * 0.05 + 0.02,
      })
    }
    return temp
  }, [])

  return (
    <>
      {particles.map((particle, i) => (
        <Float key={i} speed={1 + Math.random()} floatIntensity={0.5}>
          <Sphere position={particle.position as [number, number, number]} args={[particle.scale, 8, 8]}>
            <meshBasicMaterial color="#ffffff" transparent opacity={0.4} />
          </Sphere>
        </Float>
      ))}
    </>
  )
}

export default function Hero3D() {
  return (
    <div className="absolute inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#888888" />
        <AnimatedSphere />
        <OrbitingRings />
        <FloatingParticles />
      </Canvas>
      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black pointer-events-none" />
    </div>
  )
}
