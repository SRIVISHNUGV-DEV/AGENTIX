"use client";
import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

interface NeuralCoreProps { nodeCount?: number; className?: string; }

function NeuralSphere({ nodeCount = 64 }: { nodeCount?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  const { positions, connections } = useMemo(() => {
    const positions: number[] = [];
    const connections: number[] = [];
    const points: THREE.Vector3[] = [];
    const phi = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < nodeCount; i++) {
      const y = 1 - (i / (nodeCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = phi * i;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      positions.push(x * 2, y * 2, z * 2);
      points.push(new THREE.Vector3(x * 2, y * 2, z * 2));
    }

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (points[i].distanceTo(points[j]) < 2.5) {
          connections.push(points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z);
        }
      }
    }
    return { positions: new Float32Array(positions), connections: new Float32Array(connections) };
  }, [nodeCount]);

  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(connections, 3));
    return geometry;
  }, [connections]);

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.001;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
    if (linesRef.current) {
      linesRef.current.rotation.y += 0.001;
      linesRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
  });

  return (
    <group>
      <lineSegments ref={linesRef} geometry={lineGeometry}>
        <lineBasicMaterial color="#333333" transparent opacity={0.3} />
      </lineSegments>
      <Points ref={pointsRef} positions={positions} stride={3} frustumCulled={false}>
        <PointMaterial transparent color="#888888" size={0.08} sizeAttenuation={true} depthWrite={false} opacity={0.9} />
      </Points>
      <mesh><sphereGeometry args={[0.5, 32, 32]} /><meshBasicMaterial color="#222222" transparent opacity={0.5} /></mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#ffffff" />
      <NeuralSphere nodeCount={80} />
    </>
  );
}

export function NeuralCore({ nodeCount = 64, className }: NeuralCoreProps) {
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Scene />
      </Canvas>
    </div>
  );
}
