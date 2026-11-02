import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { LiquidGlassSceneStatus } from '../LiquidGlassScene'
import { createSceneCompiler } from './dom-scene'
import { createSceneRenderer } from './renderer'
import type { CompiledScene, GlassOptions, SceneFrame, SceneRect } from './types'

interface Options {
  root: RefObject<HTMLDivElement>
  content: RefObject<HTMLDivElement>
  canvas: RefObject<HTMLCanvasElement>
  glasses: MutableRefObject<Map<HTMLElement, GlassOptions>>
  invalidate: MutableRefObject<() => void>
  background: string | undefined
  maxPixelRatio: number
  onStatusChange: ((state: LiquidGlassSceneStatus) => void) | undefined
}

export function useScene(options: Options): void {
  const { root, content, canvas, glasses, invalidate, background, maxPixelRatio } = options
  const callback = useRef(options.onStatusChange)
  useEffect(() => {
    callback.current = options.onStatusChange
  }, [options.onStatusChange])

  useEffect(() => {
    const host = root.current
    const source = content.current
    const output = canvas.current
    if (!host || !source || !output) return
    let disposed = false
    let dirty = true
    let frameRequest: number | undefined
    let compiled: CompiledScene | undefined
    let previous: SceneFrame | undefined
    let bounds: SceneRect | undefined
    let hostFixed = false
    let generation = 0
    let formValues = new Map<HTMLInputElement | HTMLTextAreaElement, string>()
    let statusKey = ''
    let redirected = false
    let wasAnimating = false
    let lost = false
    let scrollingUntil = 0
    let renderer = createSceneRenderer(output)
    const markDirty = () => {
      dirty = true
      start()
    }
    const compiler = createSceneCompiler(markDirty)
    invalidate.current = markDirty

    const report = (state: LiquidGlassSceneStatus) => {
      const key = JSON.stringify(state)
      if (key === statusKey) return
      statusKey = key
      if (state.status === 'ready') host.setAttribute('data-liquid-glass-scene-ready', 'true')
      else host.removeAttribute('data-liquid-glass-scene-ready')
      host.dispatchEvent(new CustomEvent('liquid-glass:scene-status', { detail: state }))
      callback.current?.(state)
    }
    const cancel = () => {
      if (frameRequest !== undefined) cancelAnimationFrame(frameRequest)
      frameRequest = undefined
    }
    const baseColor = () => {
      if (background) return background
      for (const element of [host, document.body, document.documentElement]) {
        const color = getComputedStyle(element).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      }
      return '#fff'
    }
    const frame = () => {
      frameRequest = undefined
      if (disposed || document.hidden || lost) return
      const width = window.innerWidth
      const height = window.innerHeight
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        Number.isFinite(maxPixelRatio) && maxPixelRatio > 0 ? maxPixelRatio : 2,
        Math.sqrt(2_000_000 / Math.max(1, width * height)),
        4096 / Math.max(1, width),
        4096 / Math.max(1, height)
      )
      const current: SceneFrame = {
        width,
        height,
        pixelRatio,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }
      // Controlled React fields can change their value property without a DOM mutation.
      for (const [field, value] of formValues) {
        if (field.value !== value) {
          formValues.set(field, field.value)
          dirty = true
        }
      }
      const resized =
        !previous ||
        width !== previous.width ||
        height !== previous.height ||
        pixelRatio !== previous.pixelRatio
      const scrolled =
        !previous || current.scrollX !== previous.scrollX || current.scrollY !== previous.scrollY
      const animating =
        typeof source.getAnimations === 'function' &&
        source
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')
      const remeasure =
        dirty ||
        resized ||
        animating !== wasAnimating ||
        (!compiled?.issues.length && (animating || (scrolled && compiled?.liveGeometry)))
      const mediaPlaying =
        compiled?.media.some(
          (media) => media instanceof HTMLCanvasElement || (!media.paused && !media.ended)
        ) ?? false
      if (remeasure || scrolled || mediaPlaying) {
        try {
          if (remeasure) {
            const rect = host.getBoundingClientRect()
            const style = getComputedStyle(host)
            hostFixed = style.position === 'fixed'
            bounds = {
              x: rect.left + (hostFixed ? 0 : current.scrollX),
              y: rect.top + (hostFixed ? 0 : current.scrollY),
              width: rect.width,
              height: rect.height,
            }
            compiled = compiler.compile(host, glasses.current, current, baseColor())
            formValues = new Map()
            for (const { element } of compiled.targets) {
              if (
                (element instanceof HTMLInputElement && element.type !== 'password') ||
                element instanceof HTMLTextAreaElement
              )
                formValues.set(element, element.value)
            }
            // A transformed ancestor changes the fixed canvas's containing block.
            for (
              let ancestor: HTMLElement | null = host;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              const ancestorStyle = getComputedStyle(ancestor)
              if (
                [ancestorStyle.transform, ancestorStyle.perspective, ancestorStyle.filter].some(
                  (value) => value && value !== 'none'
                )
              ) {
                compiled.issues.push(
                  'LiquidGlassScene needs ancestors without transform, perspective or filter.'
                )
                break
              }
            }
            if (Number.parseFloat(style.opacity) < 1)
              compiled.issues.push(
                'Apply opacity to scene content rather than the LiquidGlassScene wrapper.'
              )
            dirty = false
            generation += 1
            if (!compiled.issues.length) {
              renderer ??= createSceneRenderer(output)
              renderer?.setScene(compiled.scene)
            }
          }
          if (compiled?.issues.length) report({ status: 'fallback', reasons: compiled.issues })
          else if (!renderer || !renderer.render(current)) {
            report({
              status: 'fallback',
              reasons: ['WebGL could not render this scene. Check media CORS and device support.'],
            })
            renderer?.dispose()
            renderer = null
          } else {
            if (bounds) {
              const x = bounds.x - (hostFixed ? 0 : current.scrollX)
              const y = bounds.y - (hostFixed ? 0 : current.scrollY)
              const clip = `inset(${Math.min(height, Math.max(0, y))}px ${Math.min(width, Math.max(0, width - x - bounds.width))}px ${Math.min(height, Math.max(0, height - y - bounds.height))}px ${Math.min(width, Math.max(0, x))}px)`
              if (output.style.clipPath !== clip) output.style.clipPath = clip
            }
            report({ status: 'ready' })
            output.dispatchEvent(
              new CustomEvent('liquid-glass:scene-frame', {
                detail: { scrollX: current.scrollX, scrollY: current.scrollY, generation },
              })
            )
          }
        } catch (error) {
          report({
            status: 'fallback',
            reasons: [error instanceof Error ? error.message : 'Scene rendering failed.'],
          })
          renderer?.dispose()
          renderer = null
        }
      }
      previous = current
      wasAnimating = animating
      // Keep sampling during motion; an idle page schedules no animation frames.
      const hasLiveMedia =
        compiled?.media.some(
          (media) => media instanceof HTMLCanvasElement || (!media.paused && !media.ended)
        ) ?? false
      if (dirty || animating || hasLiveMedia || performance.now() < scrollingUntil) start()
    }
    function start() {
      if (!disposed && !document.hidden && !lost && frameRequest === undefined)
        frameRequest = requestAnimationFrame(frame)
    }
    const onWindowScroll = () => {
      scrollingUntil = performance.now() + 120
      start()
    }
    const onVisibility = () => {
      if (document.hidden) cancel()
      else {
        markDirty()
        start()
      }
    }
    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancel()
      report({ status: 'fallback', reasons: ['WebGL context lost.'] })
      renderer?.dispose()
      renderer = null
    }
    const onRestored = () => {
      lost = false
      markDirty()
      start()
    }
    const onNestedScroll = (event: Event) => {
      if (event.target !== document) markDirty()
    }
    const onClick = (event: MouseEvent) => {
      if (
        redirected ||
        event.detail === 0 ||
        !compiled ||
        !previous ||
        host.dataset.liquidGlassSceneReady !== 'true' ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const shown = previous
      const inFixedLayer =
        event.target instanceof Element &&
        (() => {
          for (
            let element: Element | null = event.target;
            element && element !== source;
            element = element.parentElement
          ) {
            if (getComputedStyle(element).position === 'fixed') return true
          }
          return false
        })()
      let target: HTMLElement | undefined
      for (let index = compiled.targets.length - 1; index >= 0; index -= 1) {
        const candidate = compiled.targets[index]
        if (!candidate || (inFixedLayer && candidate.space === 'document')) continue
        const { rect, space } = candidate
        const x = rect.x - (space === 'document' ? shown.scrollX : 0)
        const y = rect.y - (space === 'document' ? shown.scrollY : 0)
        if (
          event.clientX >= x &&
          event.clientX <= x + rect.width &&
          event.clientY >= y &&
          event.clientY <= y + rect.height
        ) {
          target = candidate.element
          break
        }
      }
      const nativeTarget =
        event.target instanceof Element
          ? event.target.closest('a, button, input, select, textarea, [tabindex]')
          : null
      if (nativeTarget === target || (!nativeTarget && !target)) return
      event.preventDefault()
      event.stopPropagation()
      if (target?.isConnected) {
        redirected = true
        try {
          target.focus({ preventScroll: true })
          target.click()
        } finally {
          redirected = false
        }
      }
    }

    const mutation = new MutationObserver(markDirty)
    mutation.observe(source, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    const outsideStyles = new MutationObserver(markDirty)
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
      outsideStyles.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style'] })
    }
    outsideStyles.observe(document.head, { subtree: true, childList: true, characterData: true })
    const resize = new ResizeObserver(markDirty)
    resize.observe(host)
    resize.observe(source)
    const events = [
      'focusin',
      'focusout',
      'input',
      'change',
      'load',
      'error',
      'loadeddata',
      'seeked',
      'play',
      'pause',
      'animationstart',
      'animationend',
      'transitionrun',
      'transitionend',
      'pointerover',
      'pointerout',
      'pointerdown',
      'pointerup',
    ]
    for (const name of events) source.addEventListener(name, markDirty, true)
    source.addEventListener('scroll', onNestedScroll, true)
    source.addEventListener('click', onClick, true)
    // Visual viewport events also fire for browser chrome and pinch movement.
    // Let the frame compare actual layout dimensions before rebuilding the DOM.
    window.addEventListener('resize', start)
    window.addEventListener('scroll', onWindowScroll, { passive: true })
    window.visualViewport?.addEventListener('resize', start)
    document.addEventListener('visibilitychange', onVisibility)
    document.fonts?.addEventListener('loadingdone', markDirty)
    const colorScheme =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
    colorScheme?.addEventListener('change', markDirty)
    void document.fonts?.ready.then(() => {
      if (!disposed) markDirty()
    })
    output.addEventListener('webglcontextlost', onLost)
    output.addEventListener('webglcontextrestored', onRestored)
    start()

    return () => {
      disposed = true
      cancel()
      mutation.disconnect()
      outsideStyles.disconnect()
      resize.disconnect()
      for (const name of events) source.removeEventListener(name, markDirty, true)
      source.removeEventListener('scroll', onNestedScroll, true)
      source.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', start)
      window.removeEventListener('scroll', onWindowScroll)
      window.visualViewport?.removeEventListener('resize', start)
      document.removeEventListener('visibilitychange', onVisibility)
      document.fonts?.removeEventListener('loadingdone', markDirty)
      colorScheme?.removeEventListener('change', markDirty)
      output.removeEventListener('webglcontextlost', onLost)
      output.removeEventListener('webglcontextrestored', onRestored)
      renderer?.dispose()
      compiler.dispose()
      invalidate.current = () => {}
      host.removeAttribute('data-liquid-glass-scene-ready')
    }
  }, [root, content, canvas, glasses, invalidate, background, maxPixelRatio])
}
