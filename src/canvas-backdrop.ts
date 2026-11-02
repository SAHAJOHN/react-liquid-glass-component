const selector = 'canvas[data-liquid-glass-backdrop="canvas"]'

/** The source must map its entire bitmap to the viewport without transforms. */
export function isCanvasBackdrop(canvas: HTMLCanvasElement): boolean {
  if (!canvas.isConnected || !canvas.matches(selector) || canvas.width <= 0 || canvas.height <= 0) {
    return false
  }
  const style = getComputedStyle(canvas)
  if (style.position !== 'fixed' || style.transform !== 'none' || style.opacity !== '1' ||
      style.display === 'none' || style.visibility !== 'visible') return false
  const rect = canvas.getBoundingClientRect()
  const tolerance = 1
  return Math.abs(rect.left) <= tolerance && Math.abs(rect.top) <= tolerance &&
    Math.abs(rect.right - window.innerWidth) <= tolerance &&
    Math.abs(rect.bottom - window.innerHeight) <= tolerance
}

export function findCanvasBackdrop(): HTMLCanvasElement | null {
  const canvases = document.querySelectorAll<HTMLCanvasElement>(selector)
  for (const canvas of canvases) {
    if (isCanvasBackdrop(canvas)) return canvas
  }
  return null
}
