import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  compiler: {
    styledComponents: true,
  },
  turbopack: {
    root: path.join(__dirname, ".."),
  },
}

export default nextConfig
