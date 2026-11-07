/** An SVG image whose transparent padding includes the visible blur halo. */
export interface BlurredImageSource {
  source: string
  width: number
  height: number
  insetX: number
  insetY: number
}

/**
 * Encode an origin-clean bitmap as a bounded, blurred SVG image source.
 *
 * Logical dimensions and radius are CSS pixels; the backing canvas may use a
 * different raster scale on either axis. Callers must cache by source bitmap,
 * geometry, and radius: encoding PNGs on every frame is expensive. A null
 * result means the scene must retain its native fallback.
 */
export function createBlurredImageSource(
  bitmap: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  radius: number
): BlurredImageSource | null {
  if (
    ![logicalWidth, logicalHeight, radius].every(Number.isFinite) ||
    logicalWidth <= 0 ||
    logicalHeight <= 0 ||
    radius <= 0 ||
    radius > 64 ||
    !Number.isInteger(bitmap.width) ||
    !Number.isInteger(bitmap.height) ||
    bitmap.width <= 0 ||
    bitmap.height <= 0 ||
    bitmap.width > 4096 ||
    bitmap.height > 4096 ||
    bitmap.width * bitmap.height > 2_000_000
  )
    return null

  const scaleX = bitmap.width / logicalWidth
  const scaleY = bitmap.height / logicalHeight
  const sigmaX = radius * scaleX
  const sigmaY = radius * scaleY
  if (![scaleX, scaleY, sigmaX, sigmaY].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0)
    return null

  const padX = Math.ceil(sigmaX * 3) + 2
  const padY = Math.ceil(sigmaY * 3) + 2
  const width = bitmap.width + padX * 2
  const height = bitmap.height + padY * 2
  if (width > 4096 || height > 4096 || width * height > 2_000_000) return null

  try {
    // toDataURL throws for cross-origin content that taints the source canvas.
    const png = bitmap.toDataURL('image/png')
    if (png.length > 4_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) return null
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs><filter id="blur" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sigmaX} ${sigmaY}"/></filter></defs>` +
      `<image x="${padX}" y="${padY}" width="${bitmap.width}" height="${bitmap.height}" href="${png}" filter="url(#blur)"/></svg>`
    return {
      source: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      width: width / scaleX,
      height: height / scaleY,
      insetX: padX / scaleX,
      insetY: padY / scaleY,
    }
  } catch {
    return null
  }
}
