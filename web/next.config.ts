import type { NextConfig } from "next"
import path from "node:path"

const devOrigins = process.env.LIQUID_GLASS_DEV_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  // Build previews separately so updating the demo cannot remove the live server's assets.
  distDir: process.env.LIQUID_GLASS_DIST_DIR || '.next',
  ...(devOrigins?.length ? { allowedDevOrigins: devOrigins } : {}),
  compiler: {
    styledComponents: true,
  },
  turbopack: {
    root: path.join(__dirname, ".."),
  },
}

export default nextConfig
