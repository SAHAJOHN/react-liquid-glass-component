import { captureBackdrop } from './dom-capture'
import { findCanvasBackdrop, isCanvasBackdrop } from './canvas-backdrop'
import { findVideoBackdrop, type VideoBackdrop } from './video-backdrop'

type Listener = (capture: HTMLCanvasElement | null, frameId?: number) => void

const listeners = new Set<Listener>()
let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let frameId = 0
let videoBackdrop: VideoBackdrop | null | undefined
let overlay: HTMLCanvasElement | null = null
let overlayX = 0
let overlayY = 0
let videoCallback: number | undefined
let animationCallback: number | undefined
let lifecycle = 0
let canvasBackdrop: HTMLCanvasElement | null = null
let canvasNeedsValidation = false
let lastCanvasValidation = 0
let canvasObserver: MutationObserver | undefined

function hasAnimatedBackdrop(): boolean {
  if (typeof document.getAnimations !== 'function' || typeof KeyframeEffect === 'undefined') return false
  return document.getAnimations().some((animation) => {
    if (animation.playState !== 'running' || !(animation.effect instanceof KeyframeEffect)) return false
    const target = animation.effect.target
    return target instanceof Element && !target.closest('.liquid-glass')
  })
}

function emit(source: HTMLCanvasElement | null, unchanged = false): void {
  if (!unchanged) frameId += 1
  listeners.forEach((listener) => listener(source, frameId))
}

function cancelVideoFrame(): void {
  if (videoCallback !== undefined) videoBackdrop?.video.cancelVideoFrameCallback?.(videoCallback)
  if (animationCallback !== undefined) cancelAnimationFrame(animationCallback)
  videoCallback = undefined
  animationCallback = undefined
}

function activateCanvas(canvas: HTMLCanvasElement): void {
  if (canvasBackdrop === canvas) return
  lifecycle += 1
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  cancelVideoFrame()
  videoBackdrop = undefined
  overlay = null
  canvasBackdrop = canvas
  canvasNeedsValidation = false
  lastCanvasValidation = performance.now()
  if (!document.hidden) emit(canvas)
}

function deactivateCanvas(): void {
  if (!canvasBackdrop) return
  lifecycle += 1
  canvasBackdrop = null
  canvasNeedsValidation = false
  lastCanvasValidation = 0
  videoBackdrop = undefined
  overlay = null
  emit(null)
  if (!running && listeners.size) void capture()
}

function onCanvasFrame(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLCanvasElement) || !listeners.size || document.hidden) return
  if (canvasBackdrop === target) {
    const now = performance.now()
    const validate = canvasNeedsValidation || now - lastCanvasValidation >= 250
    if (!target.isConnected || target.dataset.liquidGlassBackdrop !== 'canvas' ||
        target.width <= 0 || target.height <= 0 || (validate && !isCanvasBackdrop(target))) {
      deactivateCanvas()
      return
    }
    if (validate) lastCanvasValidation = now
    canvasNeedsValidation = false
    // A producer can request a redraw without uploading the same pixels again.
    // Ordinary frame events still always represent a new source generation.
    const unchanged = event instanceof CustomEvent && event.detail?.unchanged === true
    emit(target, unchanged)
  } else if (!canvasBackdrop && isCanvasBackdrop(target)) {
    activateCanvas(target)
  }
}

function onCanvasMutation(): void {
  if (!listeners.size) return
  if (canvasBackdrop && (!canvasBackdrop.isConnected || canvasBackdrop.dataset.liquidGlassBackdrop !== 'canvas')) {
    deactivateCanvas()
  }
  if (!canvasBackdrop) {
    const canvas = findCanvasBackdrop()
    if (canvas) activateCanvas(canvas)
  }
}

function onResize(): void {
  if (!canvasBackdrop) return
  canvasNeedsValidation = true
  emit(null)
}

function showVideoFrame(): void {
  if (!videoBackdrop || !overlay || !listeners.size || document.hidden) return
  const source = videoBackdrop.render(overlay, overlayX - window.scrollX, overlayY - window.scrollY)
  if (source) emit(source)
  else if (videoBackdrop.video.readyState >= 2) {
    // Unsupported geometry or cross-origin media: return to normal DOM capture.
    cancelVideoFrame()
    videoBackdrop = null
    overlay = null
    emit(null)
  }
}

function scheduleVideoFrame(): void {
  if (!videoBackdrop || !overlay || !listeners.size || document.hidden ||
      videoCallback !== undefined || animationCallback !== undefined) return
  const video = videoBackdrop.video
  const tick = () => {
    videoCallback = undefined
    animationCallback = undefined
    showVideoFrame()
    scheduleVideoFrame()
  }
  if (typeof video.requestVideoFrameCallback === 'function') {
    videoCallback = video.requestVideoFrameCallback(tick)
  } else {
    animationCallback = requestAnimationFrame(tick)
  }
}

// One capture feeds every visible pane. Never run concurrent DOM clones.
async function capture(): Promise<void> {
  if (running || canvasBackdrop || listeners.size === 0) return
  if (document.hidden) {
    timer = setTimeout(capture, 500)
    return
  }
  running = true
  const currentLifecycle = lifecycle
  const x = window.scrollX
  const y = window.scrollY
  const width = window.innerWidth
  const height = window.innerHeight
  let delay = 500
  try {
    if (videoBackdrop === undefined) videoBackdrop = findVideoBackdrop()
    let result: HTMLCanvasElement
    if (videoBackdrop) {
      try {
        result = await captureBackdrop(document.documentElement, { excludeVideo: videoBackdrop.video })
      } catch {
        cancelVideoFrame()
        videoBackdrop = null
        overlay = null
        result = await captureBackdrop(document.documentElement)
      }
    } else {
      result = await captureBackdrop(document.documentElement)
    }
    // A capture taken during a scroll/resize no longer matches viewport coordinates.
    if (!canvasBackdrop && currentLifecycle === lifecycle && x === window.scrollX && y === window.scrollY && width === window.innerWidth && height === window.innerHeight) {
      if (videoBackdrop) {
        overlay = result
        overlayX = x
        overlayY = y
        showVideoFrame()
        scheduleVideoFrame()
        delay = hasAnimatedBackdrop() ? 350 : 850
      } else {
        emit(result)
      }
    }
  } catch {
    if (currentLifecycle === lifecycle) emit(null)
    delay = 2000
  } finally {
    running = false
    if (listeners.size > 0 && !canvasBackdrop) timer = setTimeout(capture, delay)
  }
}

function onVisibilityChange(): void {
  if (document.hidden) cancelVideoFrame()
  else if (canvasBackdrop) {
    if (isCanvasBackdrop(canvasBackdrop)) emit(canvasBackdrop)
    else deactivateCanvas()
  } else scheduleVideoFrame()
}

export function subscribeBackdrop(listener: Listener): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('liquid-glass:frame', onCanvasFrame, true)
    window.addEventListener('resize', onResize)
    canvasObserver = new MutationObserver(onCanvasMutation)
    canvasObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-liquid-glass-backdrop'],
    })
    const canvas = findCanvasBackdrop()
    if (canvas) activateCanvas(canvas)
    else if (!running) void capture()
  } else if (canvasBackdrop && !document.hidden && !canvasNeedsValidation) {
    listener(canvasBackdrop, frameId)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      lifecycle += 1
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      cancelVideoFrame()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('liquid-glass:frame', onCanvasFrame, true)
      window.removeEventListener('resize', onResize)
      canvasObserver?.disconnect()
      canvasObserver = undefined
      canvasBackdrop = null
      canvasNeedsValidation = false
      lastCanvasValidation = 0
      videoBackdrop = undefined
      overlay = null
    }
  }
}
