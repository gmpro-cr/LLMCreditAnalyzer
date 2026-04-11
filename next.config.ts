import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // All pages are dynamic — no static prerendering (Supabase requires runtime env vars)
  output: 'standalone',
  experimental: {},
}

export default nextConfig
