export interface DisplacementMapOptions {
  borderRadius: number
  borderWidth: number
  brightness: number
  opacity: number
  blur: number
  mixBlendMode: string
}

/** Shared with the SVG backdrop and managed WebGL paths so optics props keep their meaning. */
export function createDisplacementMapSvg(
  width: number,
  height: number,
  options: DisplacementMapOptions
): string {
  const edge = Math.min(width, height) * (options.borderWidth * 0.5)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="rgba(255,0,0,0)"/><stop offset="20%" stop-color="rgba(255,0,0,1)"/>
        <stop offset="80%" stop-color="rgba(255,0,0,1)"/><stop offset="100%" stop-color="rgba(255,0,0,0)"/>
      </linearGradient>
      <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="rgba(0,0,255,0)"/><stop offset="20%" stop-color="rgba(0,0,255,1)"/>
        <stop offset="80%" stop-color="rgba(0,0,255,1)"/><stop offset="100%" stop-color="rgba(0,0,255,0)"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="rgb(128,128,128)"/>
    <rect width="${width}" height="${height}" rx="${options.borderRadius}" fill="url(#red)"/>
    <rect width="${width}" height="${height}" rx="${options.borderRadius}" fill="url(#blue)" style="mix-blend-mode:${options.mixBlendMode}"/>
    <rect x="${edge}" y="${edge}" width="${width - edge * 2}" height="${height - edge * 2}" rx="${options.borderRadius}" fill="hsl(0 0% ${options.brightness}% / ${options.opacity})" style="filter:blur(${options.blur}px)"/>
  </svg>`
}
