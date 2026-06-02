import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const monorepoRoot = path.resolve(__dirname, '..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  allowedDevOrigins: ['127.0.0.1'],
  // Production: Enable standalone output for Docker
  output: 'standalone',
}

export default nextConfig
