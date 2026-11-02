import { useEffect, useRef, useState, type RefObject } from 'react'
import { subscribeBackdrop } from './backdrop-capture'
import { createWebGLRefraction } from './webgl-refraction'

interface Options {
  enabled: boolean
  root: RefObject<HTMLDivElement>
  canvas: RefObject<HTMLCanvasElement>
  borderRadius: number
  distortionScale: number
  redOffset: number
  greenOffset: number
  blueOffset: number
}

export function useWebGLBackdrop({
  enabled,
  root,
  canvas,
  borderRadius,
  distortionScale,
  redOffset,
  greenOffset,
  blueOffset,
}: Options): boolean {
  const [ready, setReady] = useState(false)
  const optics = useRef({ borderRadius, distortionScale, redOffset, greenOffset, blueOffset })
  const redraw = useRef<(() => void) | null>(null)

  useEffect(() => {
    optics.current = { borderRadius, distortionScale, redOffset, greenOffset, blueOffset }
    redraw.current?.()
  }, [borderRadius, distortionScale, redOffset, greenOffset, blueOffset])

  useEffect(() => {
    setReady(false)
    const element = root.current
    const output = canvas.current
    if (!enabled || !element || !output) return
    const renderer = createWebGLRefraction(output)
    if (!renderer) return

    let unsubscribe: (() => void) | undefined
    let disposed = false
    let lastSource: HTMLCanvasElement | null = null
    let lastFrameId: number | undefined
    let scrollFrame: number | undefined
    const cancelScrollRedraw = () => {
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
      scrollFrame = undefined
    }
    const draw = () => {
      if (disposed || !lastSource) return
      const rect = element.getBoundingClientRect()
      setReady(renderer.render(lastSource, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        ...optics.current,
        ...(lastFrameId !== undefined ? { frameId: lastFrameId } : {}),
      }))
    }
    redraw.current = draw

    const onCapture = (source: HTMLCanvasElement | null, frameId?: number) => {
      if (disposed) return
      cancelScrollRedraw()
      lastSource = source
      lastFrameId = frameId
      if (!source) {
        setReady(false)
        return
      }
      draw()
    }
    const onScroll = () => {
      if (disposed || !lastSource || scrollFrame !== undefined) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = undefined
        draw()
      })
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    const start = () => {
      if (!unsubscribe) unsubscribe = subscribeBackdrop(onCapture)
    }
    const stop = () => {
      unsubscribe?.()
      unsubscribe = undefined
      lastSource = null
      lastFrameId = undefined
      cancelScrollRedraw()
      setReady(false)
    }

    const observer = typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(([entry]) => {
          if (entry?.isIntersecting) start()
          else stop()
        })
    if (observer) observer.observe(element)
    else start()

    return () => {
      disposed = true
      redraw.current = null
      window.removeEventListener('scroll', onScroll, true)
      cancelScrollRedraw()
      observer?.disconnect()
      unsubscribe?.()
      renderer.dispose()
    }
  }, [enabled, root, canvas])

  return ready
}
