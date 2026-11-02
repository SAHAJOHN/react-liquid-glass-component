import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { LiquidGlassSceneStatus } from '../LiquidGlassScene'
import { createSceneCompiler } from './dom-scene'
import {
  canExpandElasticScene,
  externalSiblingsAvoidRegion,
  glassSamplingRegion,
  getOverscroll,
  hasFlatElasticBackground,
  isPendingAssets,
  PENDING_FRAME_MS,
  type ElasticGeometry,
  type Overscroll,
  type SamplingPane,
} from './continuity'
import { getGlassOnlyClip, type GlassOnlyClip, type GlassOnlyPane } from './glass-only-clip'
import { createSceneRenderer } from './renderer'
import { samplingBoundaryChanged, validSamplingRegion } from './sampling-boundary'
import type { CompiledScene, GlassOptions, SceneFrame, SceneRect } from './types'

interface Options {
  root: RefObject<HTMLDivElement>
  content: RefObject<HTMLDivElement>
  canvas: RefObject<HTMLCanvasElement>
  glasses: MutableRefObject<Map<HTMLElement, GlassOptions>>
  invalidate: MutableRefObject<() => void>
  background: string | undefined
  maxPixelRatio: number
  presentation: 'scene' | 'glass-only'
  onStatusChange: ((state: LiquidGlassSceneStatus) => void) | undefined
}

/** Read the same visible enclosing pane that measureGlassOnlyClip validates. */
function enclosingPaneRect(
  host: HTMLElement,
  glasses: ReadonlyMap<HTMLElement, GlassOptions>
): SceneRect | undefined {
  let largest: SceneRect | undefined
  for (const element of glasses.keys()) {
    if (!element.isConnected || !host.contains(element)) continue
    let visible = true
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        (style.opacity !== '' && Number.parseFloat(style.opacity) <= 0)
      ) {
        visible = false
        break
      }
      if (ancestor === host) break
    }
    if (!visible) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    if (!largest || rect.width * rect.height > largest.width * largest.height)
      largest = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  }
  return largest
}

function measureGlassOnlyClip(
  host: HTMLElement,
  glasses: ReadonlyMap<HTMLElement, GlassOptions>,
  viewport: { width: number; height: number },
  overscroll?: Overscroll
): GlassOnlyClip {
  const panes: GlassOnlyPane[] = []
  for (const [element, options] of glasses) {
    if (!element.isConnected) continue
    if (!host.contains(element)) {
      return { status: 'fallback', reason: 'Glass-only panes must be inside their scene.' }
    }
    let visible = true
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        (style.opacity !== '' && Number.parseFloat(style.opacity) <= 0)
      ) {
        visible = false
        break
      }
      if (style.transform && style.transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(style.transform)
        if (
          !matrix.is2D ||
          matrix.a <= 0 ||
          matrix.d <= 0 ||
          Math.abs(matrix.b) > 0.00001 ||
          Math.abs(matrix.c) > 0.00001 ||
          ((!options.studio || options.legacyRadius) &&
            (Math.abs(matrix.a - 1) > 0.00001 || Math.abs(matrix.d - 1) > 0.00001))
        ) {
          return {
            status: 'fallback',
            reason: 'Glass-only panes require supported axis-aligned transforms.',
          }
        }
      }
      if (ancestor === host) break
    }
    if (!visible) continue
    const rect = element.getBoundingClientRect()
    const half = Math.min(rect.width, rect.height) / 2
    const radius = options.studio
      ? options.legacyRadius
        ? Math.max(0, Math.min(half, options.radius))
        : (half * options.studio.shapeRadius) / 100
      : Math.max(0, Math.min(half, options.radius))
    panes.push({
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      radius,
      roundness: options.studio?.shapeRoundness ?? 2,
      shadowFactor: options.studio?.shadowFactor ?? 0,
    })
  }
  const bounds = host.getBoundingClientRect()
  const hostRect = {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }
  if (!overscroll || !(overscroll.left || overscroll.right || overscroll.top || overscroll.bottom))
    return getGlassOnlyClip(panes, viewport, hostRect)

  // Only extend by the measured elastic excursion; pane positions and the
  // renderer's scroll coordinates stay in their real viewport positions.
  const { left, right, top, bottom } = overscroll
  if (!panes.length) return getGlassOnlyClip(panes, viewport, hostRect)
  const outer = panes.reduce((largest, pane) =>
    pane.rect.width * pane.rect.height > largest.rect.width * largest.rect.height ? pane : largest
  )
  const shifted = panes.map((pane) => ({
    ...pane,
    rect: { ...pane.rect, x: pane.rect.x + left, y: pane.rect.y + top },
  }))
  const expandedHost = {
    x: hostRect.x,
    y: hostRect.y,
    width: hostRect.width + left + right,
    height: hostRect.height + top + bottom,
  }
  // A fixed pane can be partially outside the physical viewport while Safari
  // bounces. Only enlarge validation for the already-invisible portion.
  const invisibleLeft = Math.max(0, -outer.rect.x)
  const invisibleRight = Math.max(0, outer.rect.x + outer.rect.width - viewport.width)
  const invisibleTop = Math.max(0, -outer.rect.y)
  const invisibleBottom = Math.max(0, outer.rect.y + outer.rect.height - viewport.height)
  expandedHost.x -= invisibleLeft
  expandedHost.y -= invisibleTop
  expandedHost.width += invisibleLeft + invisibleRight
  expandedHost.height += invisibleTop + invisibleBottom
  const validated = getGlassOnlyClip(
    shifted,
    { width: viewport.width + left + right, height: viewport.height + top + bottom },
    expandedHost
  )
  if (validated.status !== 'ready') return validated
  const { x, y, width, height } = outer.rect
  return {
    status: 'ready',
    clipPath: `inset(${y}px ${viewport.width - x - width}px ${viewport.height - y - height}px ${x}px round ${outer.radius}px)`,
  }
}

export function useScene(options: Options): void {
  const { root, content, canvas, glasses, invalidate, background, maxPixelRatio, presentation } =
    options
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
    let samplingWasUnavailable = false
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
    let appliedGlassClip = ''
    let hasCompleteFrame = false
    let elasticBaseline: ElasticGeometry | undefined
    let pendingSince: number | undefined
    let pendingTimer: ReturnType<typeof setTimeout> | undefined
    let renderer = createSceneRenderer(output)
    const markDirty = () => {
      dirty = true
      start()
    }
    const compiler = createSceneCompiler(markDirty)
    const paneResize = presentation === 'glass-only' ? new ResizeObserver(markDirty) : undefined
    const observedPanes = new Set<HTMLElement>()
    const syncPaneObservers = () => {
      if (!paneResize) return
      for (const element of observedPanes) {
        if (glasses.current.has(element)) continue
        paneResize.unobserve(element)
        observedPanes.delete(element)
      }
      for (const element of glasses.current.keys()) {
        if (observedPanes.has(element)) continue
        observedPanes.add(element)
        paneResize.observe(element)
      }
    }
    invalidate.current = markDirty

    const report = (state: LiquidGlassSceneStatus) => {
      const key = JSON.stringify(state)
      if (key === statusKey) return
      statusKey = key
      host.toggleAttribute('data-liquid-glass-scene-ready', state.status === 'ready')
      if (state.status === 'ready') host.setAttribute('data-liquid-glass-scene-ready', 'true')
      if (state.status === 'pending') host.setAttribute('data-liquid-glass-scene-pending', 'true')
      else host.removeAttribute('data-liquid-glass-scene-pending')
      host.dispatchEvent(new CustomEvent('liquid-glass:scene-status', { detail: state }))
      callback.current?.(state)
    }
    const clearPending = () => {
      pendingSince = undefined
      if (pendingTimer !== undefined) clearTimeout(pendingTimer)
      pendingTimer = undefined
    }
    const fallback = (reasons: readonly string[]) => {
      clearPending()
      hasCompleteFrame = false
      elasticBaseline = undefined
      report({ status: 'fallback', reasons })
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
      syncPaneObservers()
      const current: SceneFrame = {
        width,
        height,
        pixelRatio,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }
      const scrolling = document.scrollingElement ?? document.documentElement
      const scrollX = getComputedStyle(scrolling).direction === 'rtl' ? 0 : current.scrollX
      const overscroll = getOverscroll(
        scrollX,
        current.scrollY,
        scrolling.scrollWidth - scrolling.clientWidth,
        scrolling.scrollHeight - scrolling.clientHeight
      )
      const bouncing = !!(
        overscroll.left ||
        overscroll.right ||
        overscroll.top ||
        overscroll.bottom
      )
      const elasticGeometry = (): ElasticGeometry | undefined => {
        const pane = enclosingPaneRect(host, glasses.current)
        if (!pane) return undefined
        const rect = host.getBoundingClientRect()
        return {
          host: {
            x: rect.left + current.scrollX,
            y: rect.top + current.scrollY,
            width: rect.width,
            height: rect.height,
          },
          pane,
          documentWidth: scrolling.scrollWidth,
          documentHeight: scrolling.scrollHeight,
          viewportWidth: width,
          viewportHeight: height,
          pixelRatio,
        }
      }
      const samplingRegion = () => {
        const panes: SamplingPane[] = []
        for (const [element, options] of glasses.current) {
          if (!element.isConnected || !host.contains(element)) continue
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          if (!options.studio) return undefined
          panes.push({
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            studio: options.studio,
          })
        }
        return glassSamplingRegion(panes, { width, height, pixelRatio })
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
      let sampledRegion: SceneRect | undefined
      let sampledRegionRead = false
      const currentSamplingRegion = () => {
        if (!sampledRegionRead) {
          sampledRegion = samplingRegion()
          sampledRegionRead = true
        }
        return sampledRegion
      }
      const regularRemeasure =
        dirty ||
        resized ||
        animating !== wasAnimating ||
        (!compiled?.issues.length &&
          (animating ||
            (scrolled && (compiled?.liveGeometry || (presentation === 'glass-only' && bouncing)))))
      const watches = compiled?.samplingWatches ?? []
      const checkSampling =
        !regularRemeasure &&
        presentation === 'glass-only' &&
        (scrolled || animating) &&
        (samplingWasUnavailable || watches.length > 0)
      let samplingChanged = false
      if (checkSampling) {
        try {
          samplingChanged = samplingWasUnavailable
            ? validSamplingRegion(currentSamplingRegion())
            : samplingBoundaryChanged(host, watches, currentSamplingRegion())
        } catch {
          // Retry within the render error boundary rather than leaking an
          // exception from a detached or otherwise unmeasurable pane.
          samplingChanged = true
        }
      }
      const remeasure = regularRemeasure || samplingChanged
      const mediaPlaying =
        compiled?.media.some(
          (media) => media instanceof HTMLCanvasElement || (!media.paused && !media.ended)
        ) ?? false
      if (remeasure || scrolled || mediaPlaying || pendingSince !== undefined) {
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
            const region = presentation === 'glass-only' ? currentSamplingRegion() : undefined
            samplingWasUnavailable = presentation === 'glass-only' && !validSamplingRegion(region)
            compiled = compiler.compile(host, glasses.current, current, baseColor(), region)
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
          const canExpand =
            presentation === 'glass-only' &&
            bouncing &&
            hasCompleteFrame &&
            canExpandElasticScene(elasticBaseline, elasticGeometry(), overscroll) &&
            (() => {
              const region = samplingRegion()
              return !!region && externalSiblingsAvoidRegion(host, region)
            })() &&
            !!document.body &&
            (() => {
              const [hostStyle, bodyStyle, htmlStyle] = [
                host,
                document.body,
                document.documentElement,
              ].map((element) => getComputedStyle(element))
              if (!hostStyle || !bodyStyle || !htmlStyle) return false
              return hasFlatElasticBackground(
                { color: hostStyle.backgroundColor, image: hostStyle.backgroundImage },
                { color: bodyStyle.backgroundColor, image: bodyStyle.backgroundImage },
                { color: htmlStyle.backgroundColor, image: htmlStyle.backgroundImage }
              )
            })()
          const glassOnly =
            presentation === 'glass-only'
              ? measureGlassOnlyClip(
                  host,
                  glasses.current,
                  { width, height },
                  canExpand ? overscroll : undefined
                )
              : undefined
          let glassClipSupported = true
          if (
            !compiled?.issues.length &&
            glassOnly?.status === 'ready' &&
            glassOnly.clipPath !== appliedGlassClip
          ) {
            output.style.clipPath = ''
            output.style.clipPath = glassOnly.clipPath
            glassClipSupported = Boolean(output.style.clipPath)
            if (glassClipSupported) appliedGlassClip = glassOnly.clipPath
            else appliedGlassClip = ''
          }
          if (compiled?.issues.length) {
            const mayHold =
              presentation === 'glass-only' &&
              hasCompleteFrame &&
              !resized &&
              glassOnly?.status === 'ready' &&
              glassOnly.clipPath === appliedGlassClip &&
              isPendingAssets(compiled.issues)
            if (mayHold) {
              const now = performance.now()
              pendingSince ??= now
              const remaining = PENDING_FRAME_MS - (now - pendingSince)
              if (remaining > 0) {
                if (pendingTimer === undefined)
                  pendingTimer = setTimeout(() => {
                    pendingTimer = undefined
                    start()
                  }, remaining)
                report({ status: 'pending', reasons: compiled.issues })
              } else fallback(compiled.issues)
            } else fallback(compiled.issues)
          } else if (glassOnly?.status === 'fallback') {
            fallback([glassOnly.reason])
          } else if (!glassClipSupported) {
            fallback(['Glass-only presentation needs CSS clip-path support.'])
          } else if (!renderer || !renderer.render(current)) {
            fallback(['WebGL could not render this scene. Check media CORS and device support.'])
            renderer?.dispose()
            renderer = null
          } else {
            clearPending()
            hasCompleteFrame = true
            if (presentation === 'glass-only' && !bouncing) elasticBaseline = elasticGeometry()
            if (bounds && presentation === 'scene') {
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
          fallback([error instanceof Error ? error.message : 'Scene rendering failed.'])
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
    const onVisualViewportChange = () => {
      if (presentation === 'glass-only') markDirty()
      else start()
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancel()
        if (pendingSince !== undefined) fallback(['Scene paused while the document is hidden.'])
      } else {
        markDirty()
        start()
      }
    }
    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancel()
      fallback(['WebGL context lost.'])
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
        presentation === 'glass-only' ||
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
    window.visualViewport?.addEventListener('resize', onVisualViewportChange)
    window.visualViewport?.addEventListener('scroll', onVisualViewportChange)
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
      clearPending()
      mutation.disconnect()
      outsideStyles.disconnect()
      resize.disconnect()
      paneResize?.disconnect()
      for (const name of events) source.removeEventListener(name, markDirty, true)
      source.removeEventListener('scroll', onNestedScroll, true)
      source.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', start)
      window.removeEventListener('scroll', onWindowScroll)
      window.visualViewport?.removeEventListener('resize', onVisualViewportChange)
      window.visualViewport?.removeEventListener('scroll', onVisualViewportChange)
      document.removeEventListener('visibilitychange', onVisibility)
      document.fonts?.removeEventListener('loadingdone', markDirty)
      colorScheme?.removeEventListener('change', markDirty)
      output.removeEventListener('webglcontextlost', onLost)
      output.removeEventListener('webglcontextrestored', onRestored)
      renderer?.dispose()
      compiler.dispose()
      invalidate.current = () => {}
      host.removeAttribute('data-liquid-glass-scene-ready')
      host.removeAttribute('data-liquid-glass-scene-pending')
    }
  }, [root, content, canvas, glasses, invalidate, background, maxPixelRatio, presentation])
}
