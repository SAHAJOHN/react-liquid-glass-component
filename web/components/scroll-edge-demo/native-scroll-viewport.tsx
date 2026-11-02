'use client'

import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { ScrollEdge } from '@/components/scroll-edge-client'
import { colors, fontWeight } from '@/lib/responsive'

const NativeScrollViewportStyled = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  z-index: 10;
  visibility: hidden;
  overflow: hidden;
  border-radius: 12px;
  color: ${colors.foreground};

  .native-scroll-viewport__box,
  .scroll-edge__scrollable {
    height: 100%;
  }

  .scroll-edge__scrollable {
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .scroll-edge__scrollable:focus-visible {
    outline: 2px solid #b4eaff;
    outline-offset: -2px;
  }

  .native-scroll-viewport__content {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
  }

  .native-scroll-viewport__content--horizontal {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    width: 800px;
  }

  .native-scroll-viewport__item {
    min-width: 0;
    padding: 14px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: clamp(1rem, 2.6vw, 1.35rem);
    font-weight: ${fontWeight.medium};
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
`

export type NativeScrollMode = 'fade' | 'blur' | 'fade-all' | 'blur-all'

interface NativeScrollViewportProps {
  mode: NativeScrollMode
  label: string
  labelledBy: string
}

interface SceneFrame {
  scrollX: number
  scrollY: number
  generation: number
}

const subscribe = () => () => {}
const isClient = () => true
const isServer = () => false
const items = Array.from({ length: 24 }, (_, index) => `Scroll item ${index + 1}`)

function readFrame(event: Event): SceneFrame | null {
  if (!(event instanceof CustomEvent)) return null
  const value: unknown = event.detail
  if (
    typeof value !== 'object' ||
    value === null ||
    !('scrollX' in value) ||
    !('scrollY' in value) ||
    !('generation' in value)
  )
    return null
  if (
    typeof value.scrollX !== 'number' ||
    typeof value.scrollY !== 'number' ||
    typeof value.generation !== 'number'
  )
    return null
  if (![value.scrollX, value.scrollY, value.generation].every(Number.isFinite)) return null
  return { scrollX: value.scrollX, scrollY: value.scrollY, generation: value.generation }
}

/** Page-local foreground for the native ScrollEdge examples, not a renderer escape API. */
export default function NativeScrollViewport({
  mode,
  label,
  labelledBy,
}: NativeScrollViewportProps) {
  const allEdges = mode.endsWith('-all')
  const fade = mode.startsWith('fade')
  const id = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const mounted = useSyncExternalStore(subscribe, isClient, isServer)

  useEffect(() => {
    const anchor = anchorRef.current
    const layer = layerRef.current
    const scene = anchor?.closest('[data-liquid-glass-scene]')
    if (!mounted || !anchor || !layer || !(scene instanceof HTMLElement)) return
    const navigation = scene.querySelector<HTMLElement>(
      '[role="navigation"][aria-label="Main navigation"]'
    )
    const scrollable = layer.querySelector<HTMLElement>('.scroll-edge__scrollable')
    if (scrollable) {
      scrollable.tabIndex = 0
      scrollable.setAttribute('role', 'region')
      scrollable.setAttribute('aria-labelledby', labelledBy)
    }

    let documentRect: { x: number; y: number; width: number; height: number } | undefined
    let navBottom = 0
    let generation: number | undefined
    let dirty = true
    let pending: number | undefined
    let disposed = false
    let lastPlacement = ''

    const measure = () => {
      const rect = anchor.getBoundingClientRect()
      documentRect = {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      }
      navBottom = navigation?.getBoundingClientRect().bottom ?? 0
      dirty = false
    }
    const place = (frame: SceneFrame) => {
      if (disposed) return
      if (dirty || generation !== frame.generation || !documentRect) measure()
      generation = frame.generation
      if (!documentRect) return
      const left = documentRect.x - frame.scrollX
      const top = documentRect.y - frame.scrollY
      const { width, height } = documentRect
      const visible =
        width > 0 &&
        height > 0 &&
        left < window.innerWidth &&
        left + width > 0 &&
        top < window.innerHeight &&
        top + height > navBottom
      const inset = visible
        ? `${Math.max(0, navBottom - top)}px ${Math.max(0, left + width - window.innerWidth)}px ${Math.max(0, top + height - window.innerHeight)}px ${Math.max(0, -left)}px`
        : '50%'
      const placement = `${left}|${top}|${width}|${height}|${inset}|${visible}`
      if (placement === lastPlacement) return
      lastPlacement = placement
      layer.style.width = `${width}px`
      layer.style.height = `${height}px`
      layer.style.transform = `translate(${left}px, ${top}px)`
      layer.style.clipPath = `inset(${inset})`
      layer.style.pointerEvents = visible ? 'auto' : 'none'
      // Clip offscreen pixels while retaining the region for keyboard/screen-reader focus.
      layer.style.visibility = 'visible'
      layer.dataset.visible = String(visible)
    }
    const nativeSync = () => {
      pending = undefined
      if (!disposed) place({ scrollX: window.scrollX, scrollY: window.scrollY, generation: -1 })
    }
    const scheduleNative = () => {
      if (pending === undefined && !disposed) pending = requestAnimationFrame(nativeSync)
    }
    const isOwnFrame = (event: Event) =>
      event.target instanceof HTMLCanvasElement &&
      event.target.closest('[data-liquid-glass-scene]') === scene
    const onFrame = (event: Event) => {
      if (!isOwnFrame(event)) return
      const frame = readFrame(event)
      if (frame) place(frame)
    }
    const onScroll = () => {
      if (scene.dataset.liquidGlassSceneReady !== 'true') scheduleNative()
    }
    const onResize = () => {
      dirty = true
      if (scene.dataset.liquidGlassSceneReady !== 'true') scheduleNative()
    }
    const onStatus = (event: Event) => {
      if (event.target !== scene) return
      dirty = true
      if (scene.dataset.liquidGlassSceneReady !== 'true') scheduleNative()
    }
    const onFocus = () => {
      if (!scrollable?.matches(':focus-visible')) return
      const rect = anchor.getBoundingClientRect()
      if (rect.top < navBottom || rect.bottom > window.innerHeight) {
        anchor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      }
    }

    const resize = new ResizeObserver(onResize)
    resize.observe(anchor)
    if (navigation) resize.observe(navigation)
    document.addEventListener('liquid-glass:scene-frame', onFrame, true)
    document.addEventListener('liquid-glass:scene-status', onStatus, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    layer.addEventListener('focusin', onFocus)
    scheduleNative()

    return () => {
      disposed = true
      if (pending !== undefined) cancelAnimationFrame(pending)
      resize.disconnect()
      document.removeEventListener('liquid-glass:scene-frame', onFrame, true)
      document.removeEventListener('liquid-glass:scene-status', onStatus, true)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      layer.removeEventListener('focusin', onFocus)
    }
  }, [mounted, labelledBy])

  return (
    <>
      <div
        ref={anchorRef}
        className="scroll-edge-demo__viewport"
        data-native-scroll-anchor={mode}
        aria-owns={`${id}-viewport`}
      />
      {mounted &&
        createPortal(
          <NativeScrollViewportStyled
            ref={layerRef}
            id={`${id}-viewport`}
            data-native-scroll-viewport={mode}
            role="group"
            aria-label={`${label} viewport`}
          >
            <ScrollEdge
              edges={allEdges ? ['top', 'bottom', 'left', 'right'] : ['top', 'bottom']}
              shadow={fade}
              blur={!fade}
              divCount={4}
              className="native-scroll-viewport__box"
            >
              <div
                className={`native-scroll-viewport__content${allEdges ? ' native-scroll-viewport__content--horizontal' : ''}`}
              >
                {items.map((item) => (
                  <div className="native-scroll-viewport__item" key={item}>
                    {item}
                  </div>
                ))}
              </div>
            </ScrollEdge>
          </NativeScrollViewportStyled>,
          document.body
        )}
    </>
  )
}
