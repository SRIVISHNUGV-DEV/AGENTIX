'use client'

import dynamic from 'next/dynamic'

// Dynamically import 3D component to avoid SSR issues
const Hero3D = dynamic(() => import('@/components/hero-3d'), { ssr: false })

export default function Hero3DWrapper() {
  return <Hero3D />
}
