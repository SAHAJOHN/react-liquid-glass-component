/** A fast path for an explicitly marked, fixed, viewport-covering video. */
export interface VideoBackdrop {
  readonly video: HTMLVideoElement
  render(overlay: HTMLCanvasElement, offsetX: number, offsetY: number): HTMLCanvasElement | null
}

export function findVideoBackdrop(): VideoBackdrop | null {
  const video = document.querySelector<HTMLVideoElement>('video[data-liquid-glass-backdrop="video"]')
  if (!video) return null
  const style = getComputedStyle(video)
  const rect = video.getBoundingClientRect()
  if (
    style.position !== 'fixed' || style.transform !== 'none' || style.opacity !== '1' ||
    rect.left > 0 || rect.top > 0 || rect.right < window.innerWidth || rect.bottom < window.innerHeight ||
    (style.objectFit !== 'cover' && style.objectFit !== 'fill')
  ) return null

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  let verifiedSource = ''

  return {
    video,
    render(overlay, offsetX, offsetY) {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null
      const width = window.innerWidth
      const height = window.innerHeight
      if (width <= 0 || height <= 0) return null
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height

      const bounds = video.getBoundingClientRect()
      const currentStyle = getComputedStyle(video)
      if (bounds.left > 0 || bounds.top > 0 || bounds.right < width || bounds.bottom < height ||
          currentStyle.position !== 'fixed' || currentStyle.transform !== 'none' || currentStyle.opacity !== '1' ||
          (currentStyle.objectFit !== 'cover' && currentStyle.objectFit !== 'fill')) return null

      const scaleX = bounds.width / video.videoWidth
      const scaleY = bounds.height / video.videoHeight
      const coverScale = Math.max(scaleX, scaleY)
      const drawWidth = video.videoWidth * (currentStyle.objectFit === 'cover' ? coverScale : scaleX)
      const drawHeight = video.videoHeight * (currentStyle.objectFit === 'cover' ? coverScale : scaleY)
      const positions = currentStyle.objectPosition.split(/\s+/)
      const x = bounds.left + positionOffset(positions[0], bounds.width - drawWidth)
      const y = bounds.top + positionOffset(positions[1], bounds.height - drawHeight)

      try {
        context.clearRect(0, 0, width, height)
        context.drawImage(video, x, y, drawWidth, drawHeight)
        if (verifiedSource !== video.currentSrc) {
          // Verify CORS once per source, rather than forcing a GPU readback every frame.
          context.getImageData(0, 0, 1, 1)
          verifiedSource = video.currentSrc
        }
        context.drawImage(overlay, offsetX, offsetY)
        return canvas
      } catch {
        return null
      }
    },
  }
}

function positionOffset(position: string | undefined, available: number): number {
  if (!position || position === 'center') return available / 2
  if (position === 'left' || position === 'top') return 0
  if (position === 'right' || position === 'bottom') return available
  const value = Number.parseFloat(position)
  if (!Number.isFinite(value)) return available / 2
  return position.endsWith('%') ? available * value / 100 : value
}
